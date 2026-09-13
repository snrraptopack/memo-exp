/**
 * Measures the built package graphs and the real todo browser bundle.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const staticImport =
  /\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g;

function packageGraph(entries: string | readonly string[]): string[] {
  const list = typeof entries === 'string' ? [entries] : entries;
  const pending = list.map((entry) => resolve(root, entry));
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(staticImport)) {
      pending.push(resolve(dirname(file), match[1]!));
    }
  }

  return [...visited];
}

function measure(
  label: string,
  entries: string | readonly string[],
): { raw: number; gzip: number; files: readonly string[] } {
  const files = packageGraph(entries);
  const raw = files.reduce(
    (total, file) => total + readFileSync(file).byteLength,
    0,
  );
  const gzip = files.reduce(
    (total, file) => total + gzipSync(readFileSync(file)).byteLength,
    0,
  );
  console.log(
    `${label.padEnd(18)} ${String(raw).padStart(8)} B raw  ${String(gzip).padStart(8)} B gzip  (${files.length} file${files.length === 1 ? '' : 's'})`,
  );
  return { raw, gzip, files };
}

function browserAssets(directory: string): string[] {
  const absolute = resolve(root, directory);
  return readdirSync(absolute, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

measure('runtime client', 'packages/runtime/dist/index.js');
measure('runtime hydrate', 'packages/runtime/dist/hydrate.js');
measure('runtime hot', 'packages/runtime/dist/hot.js');
measure('runtime server', 'packages/runtime/dist/server.js');
measure('compiler', 'packages/compiler/dist/index.js');
measure('Vite adapter', 'packages/vite/dist/index.js');
const browser = measure(
  'todo browser',
  browserAssets('bench/package-size/dist/assets'),
);

// Accepted list-performance spend: source-scoped structural commits and the
// topology fast paths add under 1 kB raw to the previous measured graph. Keep
// the ceiling narrow so a later compensation pass remains measurable.
const MAX_BROWSER_RAW = 29_000;
const MAX_BROWSER_GZIP = 10_000;
if (browser.raw > MAX_BROWSER_RAW || browser.gzip > MAX_BROWSER_GZIP) {
  throw new Error(
    `todo browser bundle exceeds its budget: ${browser.raw} B raw / ${browser.gzip} B gzip ` +
      `(limits: ${MAX_BROWSER_RAW} B raw / ${MAX_BROWSER_GZIP} B gzip)`,
  );
}

const forbiddenBrowserRuntime = [
  'node:async_hooks',
  'memoized-dom-hmr',
  'memoized-dom: hydrate',
  'application-root marker',
] as const;
const browserSource = browser.files
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
for (const marker of forbiddenBrowserRuntime) {
  if (browserSource.includes(marker)) {
    throw new Error(`todo browser bundle leaked runtime marker '${marker}'`);
  }
}

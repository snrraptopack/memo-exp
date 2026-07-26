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
): void {
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

measure('runtime', 'packages/runtime/dist/index.js');
measure('compiler', 'packages/compiler/dist/index.js');
measure('Vite adapter', 'packages/vite/dist/index.js');
measure('todo browser', browserAssets('examples/dist/assets'));

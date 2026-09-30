/**
 * Optimistic bundle-size estimate for replacing canonical state keys with IDs.
 * This text substitution is intentionally not executable code: it omits the
 * dictionary and runtime changes that real interning would require.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const keyPattern = /\.\/[A-Za-z0-9./_-]+#[A-Za-z0-9._-]+(?:\\(?:0|u0000)memo-dom:list-structure-reader)?/g;

for (const directory of process.argv.slice(2)) {
  const root = resolve(directory);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => resolve(entry.parentPath, entry.name));
  const sources = files.map(file => readFileSync(file, 'utf8'));
  const occurrences = sources.flatMap(source => [...source.matchAll(keyPattern)]
    .map(match => match[0]));
  // Replace longer paths first so `#state` does not consume `#state.value`.
  const keys = [...new Set(occurrences)].sort((a, b) =>
    b.length - a.length || a.localeCompare(b));
  const rewritten = sources.map(source => keys.reduce(
    (current, key, id) => current.replaceAll(key, String(id)), source));
  const size = (chunks: readonly string[]) => ({
    raw: chunks.reduce((sum, source) => sum + Buffer.byteLength(source), 0),
    gzip: chunks.reduce((sum, source) => sum + gzipSync(source).byteLength, 0),
  });
  const current = size(sources);
  const candidate = size(rewritten);
  console.log(`${directory}: ${files.length} chunks, ${keys.length} keys, ${occurrences.length} occurrences`);
  console.log(`  current   ${current.raw} B raw / ${current.gzip} B gzip`);
  console.log(`  candidate ${candidate.raw} B raw / ${candidate.gzip} B gzip`);
  console.log(`  saving    ${current.raw - candidate.raw} B raw / ${current.gzip - candidate.gzip} B gzip before dictionary and runtime costs`);
}

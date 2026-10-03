/** Select an isolated compiler snapshot for local before/after builds. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadBenchmarkCompiler(): Promise<typeof import('@memoized-dom/compiler')> {
  const argument = process.argv.find(value => value.startsWith('--compiler='));
  return argument === undefined ? import('@memoized-dom/compiler')
    : import(pathToFileURL(resolve(argument.slice('--compiler='.length))).href);
}

/** Load an archived compiler/Vite graph without changing the checkout. */
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type memoizedDom from '@memoized-dom/vite';

export async function compilerBaseline(repository: string, revision: string, directory: string): Promise<typeof memoizedDom> {
  await mkdir(directory, { recursive: true });
  const archive = resolve(directory, 'compiler.tar');
  execFileSync('git', ['archive', `--output=${archive}`, revision,
    'packages/compiler/src', 'packages/compiler/package.json', 'packages/vite/src', 'packages/vite/package.json'], { cwd: repository });
  execFileSync('tar', ['-xf', archive, '-C', directory]);
  const entry = resolve(directory, 'plugin.mjs');
  await build({ entryPoints: [resolve(directory, 'packages/vite/src/index.ts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'compiler-baseline', setup(builder) {
      builder.onResolve({ filter: /^@memoized-dom\/compiler$/ }, () => ({ path: resolve(directory, 'packages/compiler/src/index.ts') }));
    } }] });
  return (await import(pathToFileURL(entry).href)).default;
}

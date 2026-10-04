import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { build } from 'esbuild';
import { assertPin, directory, fixtureDirectory } from './pin';
import { pnpm } from './process';

export interface MemoizedBuildOptions {
  readonly compiler?: typeof compileModules;
  readonly runtimeEntry?: string;
  readonly output?: string;
  readonly sources?: Record<string, string>;
}

export function memoizedSources(): Record<string, string> {
  return Object.fromEntries(['App.tsx', 'model.ts', 'main.ts'].map(file => [
    `./bench/octane/memoized-dom/${file}`, readFileSync(resolve(directory, 'memoized-dom', file), 'utf8'),
  ]));
}

export async function buildMemoized(options: MemoizedBuildOptions = {}): Promise<string> {
  const output = options.output ?? resolve(directory, 'memoized-dom/dist');
  mkdirSync(output, { recursive: true });
  const sources = options.sources ?? memoizedSources();
  const compiled = (options.compiler ?? compileModules)(sources, { runtimePath: '@memoized-dom/runtime' });
  for (const [id, source] of Object.entries(compiled)) {
    writeFileSync(resolve(output, basename(id)), source);
  }
  await build({ entryPoints: [resolve(output, 'main.ts')], outfile: resolve(output, 'main.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'esnext', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    ...(options.runtimeEntry === undefined ? {} : { alias: { '@memoized-dom/runtime': options.runtimeEntry } }),
  });
  // Preserve the fixture's Bootstrap styles and root/container structure.
  const html = readFileSync(resolve(fixtureDirectory, 'octane-jsx/index.html'), 'utf8')
    .replace('octane (JSX)', 'memoized-dom').replace('/src/main.js', '/main.js');
  writeFileSync(resolve(output, 'index.html'), html);
  return output;
}
export async function buildTargets(names: readonly string[], comparison?: {
  readonly before: MemoizedBuildOptions; readonly after: MemoizedBuildOptions;
}): Promise<Map<string, string>> {
  assertPin();
  const outputs = new Map<string, string>();
  for (const name of names) {
    console.log(`Production build: ${name}`);
    if (name === 'memoized-dom') outputs.set(name, await buildMemoized(comparison?.after));
    else if (name === 'memoized-dom-before' && comparison) outputs.set(name, await buildMemoized(comparison.before));
    else {
      await pnpm(['--filter', `${name}-jsbench`, 'build']);
      outputs.set(name, resolve(fixtureDirectory, name, 'dist'));
    }
  }
  assertPin();
  return outputs;
}

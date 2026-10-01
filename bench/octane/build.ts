import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { build } from 'esbuild';
import { assertPin, directory, fixtureDirectory } from './pin';
import { pnpm } from './process';

export async function buildMemoized(): Promise<string> {
  const output = resolve(directory, 'memoized-dom/dist');
  mkdirSync(output, { recursive: true });
  const sources = Object.fromEntries(['App.tsx', 'model.ts', 'main.ts'].map(file => [
    `./bench/octane/memoized-dom/${file}`, readFileSync(resolve(directory, 'memoized-dom', file), 'utf8'),
  ]));
  const compiled = compileModules(sources, { runtimePath: '@memoized-dom/runtime' });
  for (const [id, source] of Object.entries(compiled)) {
    writeFileSync(resolve(output, basename(id)), source);
  }
  await build({ entryPoints: [resolve(output, 'main.ts')], outfile: resolve(output, 'main.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'esnext', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' } });
  // Preserve the fixture's Bootstrap styles and root/container structure.
  const html = readFileSync(resolve(fixtureDirectory, 'octane-jsx/index.html'), 'utf8')
    .replace('octane (JSX)', 'memoized-dom').replace('/src/main.js', '/main.js');
  writeFileSync(resolve(output, 'index.html'), html);
  return output;
}
export async function buildTargets(names: readonly string[]): Promise<Map<string, string>> {
  assertPin();
  const outputs = new Map<string, string>();
  for (const name of names) {
    console.log(`Production build: ${name}`);
    if (name === 'memoized-dom') outputs.set(name, await buildMemoized());
    else {
      await pnpm(['--filter', `${name}-jsbench`, 'build']);
      outputs.set(name, resolve(fixtureDirectory, name, 'dist'));
    }
  }
  assertPin();
  return outputs;
}

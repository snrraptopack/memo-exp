import { expect, it } from 'bun:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

it('keeps compiler tooling out of the desktop runtime graph', async () => {
  const result = await build({ entryPoints: [resolve(import.meta.dirname, '../src/index.ts')],
    bundle: true, format: 'esm', platform: 'node', write: false, metafile: true });
  const inputs = Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/'));
  expect(inputs.some(input => input.includes('packages/compiler/'))).toBe(false);
  expect(inputs.some(input => input.includes('node_modules/'))).toBe(false);
  expect(inputs.some(input => /\/(list-dom|mount-core|hydration|markup)\.js$/.test(input))).toBe(false);
});

it('keeps desktop emission out of the ordinary compiler entry graph', async () => {
  const result = await build({ entryPoints: [resolve(import.meta.dirname, '../../compiler/dist/index.js')],
    bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false, metafile: true });
  const inputs = Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/'));
  expect(inputs.some(input => input.endsWith('/desktop.js') || input.includes('/desktop/'))).toBe(false);
});

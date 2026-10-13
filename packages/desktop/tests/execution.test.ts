import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { executionCommand, resolveExecutionBackend } from '../src/dev/execution';

test('Bun is the default and Node uses the same host adapter', () => {
  expect(resolveExecutionBackend().name).toBe('bun');
  expect(executionCommand('app.mjs')).toEqual(['bun', 'app.mjs']);
  expect(executionCommand('app.mjs', 'node', ['--fixture'])).toEqual(['node', 'app.mjs', '--fixture']);
  expect(resolveExecutionBackend('bun').hostAdapter).toBe(resolveExecutionBackend('node').hostAdapter);
});

test('custom engines declare their capabilities without shell interpolation or guessed APIs', () => {
  const backend = {
    name: 'quickjs',
    command: ['C:/custom path/qjs.exe', '--module'] as const,
    moduleFormat: 'esm' as const,
    hostAdapter: './quickjs-host.ts',
  };
  expect(executionCommand('app file.js', backend, ['literal;argument'])).toEqual([
    'C:/custom path/qjs.exe', '--module', 'app file.js', 'literal;argument',
  ]);
  expect(resolveExecutionBackend(backend).hostAdapter).toBe('./quickjs-host.ts');
});

test('a runtime name alone cannot falsely promise an unimplemented engine adapter', () => {
  expect(() => resolveExecutionBackend('quickjs' as never)).toThrow('Custom execution backends');
  expect(() => resolveExecutionBackend({
    name: 'custom', command: ['custom'], moduleFormat: 'esm', hostAdapter: '',
  })).toThrow();
});

test('portable client bundle contains no Node/Bun platform imports', async () => {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL('../src/host/index.ts', import.meta.url))],
    target: 'browser',
  });
  expect(result.success).toBe(true);
  const text = await result.outputs[0]!.text();
  expect(text).not.toMatch(/node:|Bun\./);
});

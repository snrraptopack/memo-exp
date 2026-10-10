import { expect, it } from 'bun:test';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';

it('uses framework JSX types in the editor even when React is imported', () => {
  const configPath = resolve(import.meta.dirname, '../../compiler/tsconfig.test.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const fixture = resolve(import.meta.dirname, '../../compiler/tests/jsx-types.tsx');
  const program = ts.createProgram([fixture], { ...parsed.options, incremental: false });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.file?.fileName.replaceAll('\\', '/') === fixture.replaceAll('\\', '/'));
  expect(
    diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')),
  ).toEqual([]);
});

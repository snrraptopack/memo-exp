import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { diagnosticCodes } from '../src/diagnostics/catalog';
import { createLanguageService } from '../src/plugin';

interface TestService {
  service: ts.LanguageService;
  fileName: string;
}

describe('prefer const guidance', () => {
  it('teaches that const collections can remain reactive mutation targets', () => {
    const { service, fileName } = languageService(`
      let items = [1, 2];
      items.push(3);
      const view = <ul>{items.map(item => <li>{item}</li>)}</ul>;
    `);

    const diagnostic = memoDiagnostics(service, fileName)[0]!;
    expect(diagnostic.code).toBe(diagnosticCodes.preferConst);
    expect(String(diagnostic.messageText)).toContain(
      'reactivity follows state reads and assignments',
    );
    expect(String(diagnostic.messageText)).toContain(
      'const arrays and objects may still mutate their contents',
    );
  });

  it('does not suggest const for assignments or updates in nested callbacks', () => {
    const { service, fileName } = languageService(`
      let count = 0;
      let label = 'waiting';
      count++;
      const update = () => {
        label = 'ready';
      };
      update();
    `);

    expect(memoDiagnostics(service, fileName)).toEqual([]);
  });

  it('does not confuse member writes with rebinding', () => {
    const { service, fileName } = languageService(`
      let state = { count: 0 };
      state.count++;
    `);

    expect(memoDiagnostics(service, fileName)).toHaveLength(1);
  });

  it('uses TypeScript symbols rather than matching shadowed names', () => {
    const { service, fileName } = languageService(`
      let value = 1;
      function update() {
        let value = 2;
        value++;
      }
      console.log(value, update);
    `);

    const diagnostics = memoDiagnostics(service, fileName);
    expect(diagnostics).toHaveLength(1);
    expect(String(diagnostics[0]!.messageText)).toContain("'value'");
  });

  it('requires every binding in one declaration list to be const-safe', () => {
    const { service, fileName } = languageService(`
      let stable = 1, changing = 2;
      changing += stable;
    `);

    expect(memoDiagnostics(service, fileName)).toEqual([]);
  });

  it('skips uninitialized declarations', () => {
    const { service, fileName } = languageService(`
      let value: number;
      value = 1;
      console.log(value);
    `);

    expect(memoDiagnostics(service, fileName)).toEqual([]);
  });

  it('returns an editor code fix that changes only the keyword', () => {
    const { service, fileName } = languageService(`
      export let items = [1, 2];
      items.push(3);
    `);
    const diagnostic = memoDiagnostics(service, fileName)[0]!;
    const fixes = service.getCodeFixesAtPosition(
      fileName,
      diagnostic.start!,
      diagnostic.start! + diagnostic.length!,
      [diagnosticCodes.preferConst],
      {},
      {},
    );

    const fix = fixes.find(
      (candidate) => candidate.fixName === 'memoizedDomPreferConst',
    )!;
    expect(fix.changes[0]!.textChanges).toEqual([
      {
        span: { start: diagnostic.start, length: 3 },
        newText: 'const',
      },
    ]);
  });

  it('can be disabled through the tsconfig plugin entry', () => {
    const { service, fileName } = languageService(
      'let stable = 1; console.log(stable);',
      { preferConst: false },
    );

    expect(memoDiagnostics(service, fileName)).toEqual([]);
  });
});

function memoDiagnostics(
  service: ts.LanguageService,
  fileName: string,
): ts.Diagnostic[] {
  return service
    .getSemanticDiagnostics(fileName)
    .filter((diagnostic) => diagnostic.source === 'memoized-dom');
}

function languageService(
  source: string,
  config: Record<string, unknown> = {},
): TestService {
  const fileName = normalizePath(
    resolve(process.cwd(), 'virtual-app.tsx'),
  );
  const files = new Map([[fileName, { version: '0', source }]]);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      strict: true,
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (name) => files.get(name)?.version ?? '0',
    getScriptSnapshot: (name) => {
      const text = files.get(name)?.source ?? ts.sys.readFile(name);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (options) =>
      ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };
  const original = ts.createLanguageService(host);
  const service = createLanguageService(ts, {
    languageService: original,
    config,
  } as ts.server.PluginCreateInfo);
  return { service, fileName };
}

function normalizePath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'bun:test';
import { createLanguageService } from '../src/plugin';

const contracts = `
  declare module '@memoized-dom/server' {
    export type ServerMiddleware = (context: { user?: string }, next: () => Promise<Response>) => Response | Promise<Response>;
  }
  declare module '@memoized-dom/data' {
    export interface StandardSchemaV1<Input = unknown, Output = Input> {
      readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (input: unknown) =>
          { value: Output; issues?: undefined } | { issues: readonly { message: string }[]; value?: undefined } |
          Promise<{ value: Output; issues?: undefined } | { issues: readonly { message: string }[]; value?: undefined }>;
      };
    }
  }
  declare module 'guards' {
    export const guard: import('@memoized-dom/server').ServerMiddleware;
    export const spare: number;
  }
`;

function languageService(source: string, options: { server?: string; enabled?: boolean; js?: boolean; warm?: boolean } = {}) {
  const root = resolve(process.cwd(), 'virtual-project').replaceAll('\\', '/');
  const fileName = `${root}/${options.server ?? 'server'}/functions/stories.${options.js ? 'js' : 'ts'}`;
  const files = new Map<string, { source: string; version: number }>([
    [fileName, { source, version: 0 }],
    [`${root}/contracts.d.ts`, { source: contracts, version: 0 }],
  ]);
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noUnusedLocals: true,
      skipLibCheck: true, allowJs: true, checkJs: true }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: name => String(files.get(name)?.version ?? 0),
    getScriptSnapshot: name => {
      const text = files.get(name)?.source ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: name => files.has(name) || ts.sys.fileExists(name),
    readFile: name => files.get(name)?.source ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
  };
  const original = ts.createLanguageService(host);
  if (options.warm) original.getSemanticDiagnostics(fileName);
  const service = createLanguageService(ts, { languageService: original, languageServiceHost: host,
    config: { compilerDiagnostics: false, preferConst: false, server: options.server,
      serverFunctionAnnotations: options.enabled } } as ts.server.PluginCreateInfo);
  return { service, fileName, files, original };
}

describe('server function annotation types', { timeout: 30_000 }, () => {
  it('counts annotation imports as used without shadowing them and keeps real unused diagnostics', () => {
    const source = `
      import { guard as __mmd_annotation_check, spare as unused } from 'guards';
      /** @POST @middleware [__mmd_annotation_check] */
      export async function vote(id: number) { return { id }; }
    `;
    const { service, fileName } = languageService(source, { warm: true });
    const diagnostics = service.getSemanticDiagnostics(fileName);
    const unused = diagnostics.filter(diagnostic => diagnostic.code === 6133);
    expect(unused).toHaveLength(1);
    expect(String(unused[0]?.messageText)).toContain('unused');
    expect(diagnostics.filter(diagnostic => diagnostic.source === 'memoized-dom')).toEqual([]);
    expect(service.getProgram()?.getSourceFile(fileName)?.text.startsWith(source)).toBe(true);
    service.dispose();
  });

  it('checks middleware signatures and points errors at the annotation', () => {
    const { service, fileName } = languageService(`
      const guard = (wrong: number) => wrong;
      /** @POST @middleware [guard] */
      export async function vote(id: number) { return { id }; }
    `);
    const diagnostic = service.getSemanticDiagnostics(fileName).find(diagnostic => diagnostic.source === 'memoized-dom');
    expect(diagnostic).toBeDefined();
    expect(String(diagnostic?.messageText)).toContain('@middleware');
    expect(String(diagnostic?.messageText)).toContain('ServerMiddleware');
    expect(diagnostic?.file?.text.slice(diagnostic.start, diagnostic.start! + diagnostic.length!)).toContain('@middleware');
    service.dispose();
  });

  it('checks schema output against named function arguments and supports async validators', () => {
    const { service, fileName } = languageService(`
      const input = { '~standard': { version: 1 as const, vendor: 'test',
        async validate(_input: unknown) { return { value: { id: 'wrong' } }; } } };
      /** @POST @Input input */
      const save = async (id: number) => ({ id });
      export { save as vote };
    `);
    const diagnostics = service.getSemanticDiagnostics(fileName).filter(diagnostic => diagnostic.source === 'memoized-dom');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(String(diagnostics[0]?.messageText)).toContain('@Input');
    expect(String(diagnostics[0]?.messageText)).toContain('number');
    service.dispose();
  });

  it('accepts compatible schema defaults and diagnoses unknown output arguments', () => {
    const good = languageService(`
      const input = { '~standard': { version: 1 as const, vendor: 'test',
        validate(_input: unknown) { return { value: {} }; } } };
      /** @GET @Input input */
      export async function stories(limit: number = 20) { return [limit]; }
    `);
    expect(good.service.getSemanticDiagnostics(good.fileName)).toEqual([]);
    good.service.dispose();
    const bad = languageService(`
      const input = { '~standard': { version: 1 as const, vendor: 'test',
        validate(_input: unknown) { return { value: { id: 1, extra: true } }; } } };
      /** @POST @Input input */
      export async function vote(id: number) { return { id }; }
    `);
    expect(bad.service.getSemanticDiagnostics(bad.fileName).some(diagnostic =>
      diagnostic.source === 'memoized-dom' && String(diagnostic.messageText).includes('@Input'))).toBe(true);
    bad.service.dispose();
  });

  it('updates annotation diagnostics when the source changes', () => {
    const source = `const guard = () => 1;
      /** @POST @middleware [guard] */ export async function vote() { return {}; }`;
    const { service, fileName, files } = languageService(source);
    expect(service.getSemanticDiagnostics(fileName).some(diagnostic => diagnostic.source === 'memoized-dom')).toBe(true);
    files.set(fileName, { version: 1, source: source.replace('const guard = () => 1;',
      'const guard = (_context: unknown, next: () => Promise<Response>) => next();') });
    expect(service.getSemanticDiagnostics(fileName)).toEqual([]);
    service.dispose();
  });

  it('reports missing runtime annotation references through shared compiler analysis', () => {
    const { service, fileName } = languageService(`
      /** @POST @middleware [missingGuard] */
      export async function vote() { return {}; }
    `);
    expect(service.getSemanticDiagnostics(fileName).some(diagnostic =>
      diagnostic.source === 'memoized-dom' && String(diagnostic.messageText).includes('missingGuard'))).toBe(true);
    service.dispose();
  });

  it('supports custom server roots and can be disabled', () => {
    const source = `const guard = (_context: unknown, next: () => Promise<Response>) => next();
      /** @POST @middleware [guard] */ export async function vote() { return {}; }`;
    const enabled = languageService(source, { server: 'backend' });
    expect(enabled.service.getSemanticDiagnostics(enabled.fileName)).toEqual([]);
    enabled.service.dispose();
    const disabled = languageService(source, { enabled: false });
    expect(disabled.service.getSemanticDiagnostics(disabled.fileName).some(diagnostic => diagnostic.code === 6133)).toBe(true);
    disabled.service.dispose();
  });

  it('does not inject TypeScript syntax into JavaScript middleware annotations', () => {
    const { service, fileName } = languageService(`
      /** @type {import('@memoized-dom/server').ServerMiddleware} */
      const guard = (_context, next) => next();
      /** @POST @middleware [guard] */ export async function vote() { return {}; }
    `, { js: true });
    expect(service.getSyntacticDiagnostics(fileName)).toEqual([]);
    expect(service.getSemanticDiagnostics(fileName)).toEqual([]);
    service.dispose();
  });
});

import type * as ts from 'typescript';
import { analyzeServerFunctionModule, toCompilerDiagnostic, type ServerFunctionDefinition } from '@memoized-dom/compiler';
import { diagnosticCodes, diagnosticSource } from './diagnostics/catalog';

type TypeScript = typeof ts;

export interface ServerFunctionTypeOptions {
  /** Match Vite's server folder convention, including a custom server root. */
  server?: string;
  serverFunctionAnnotations?: boolean;
}

interface TypeCheckRange {
  start: number;
  end: number;
  authoredStart: number;
  authoredLength: number;
  tag: 'middleware' | 'Input';
}

export interface ServerFunctionTypeSource {
  authored: string;
  text: string;
  ranges: TypeCheckRange[];
  diagnostics: ts.DiagnosticWithLocation[];
}

function normalizePath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

/** Append type-only checks in memory; authored files and runtime code stay untouched. */
export function serverFunctionTypeSource(
  typescript: TypeScript,
  fileName: string,
  authored: string,
  options: ServerFunctionTypeOptions = {},
): ServerFunctionTypeSource {
  const result: ServerFunctionTypeSource = { authored, text: authored, ranges: [], diagnostics: [] };
  const file = normalizePath(fileName);
  const server = normalizePath(options.server ?? 'server').replace(/^\.\//, '').replace(/\/$/, '');
  const marker = `${server.startsWith('/') || /^[A-Za-z]:/.test(server) ? '' : '/'}${server}/functions/`;
  if (options.serverFunctionAnnotations === false || file.includes('/node_modules/') ||
    file.endsWith('.d.ts') || !/\.[jt]sx?$/.test(file) || !file.includes(marker)) return result;

  const sourceFile = typescript.createSourceFile(fileName, authored, typescript.ScriptTarget.Latest, true);
  let metadata;
  try {
    metadata = analyzeServerFunctionModule(authored, { moduleId: fileName, functionsRoot: `${server}/functions` });
  } catch (error) {
    const diagnostic = toCompilerDiagnostic(error, [fileName]);
    const line = Math.min(Math.max(0, (diagnostic.line ?? 1) - 1), sourceFile.getLineStarts().length - 1);
    const start = sourceFile.getPositionOfLineAndCharacter(line, diagnostic.column ?? 0);
    result.diagnostics.push({ file: sourceFile, start, length: 1,
      category: typescript.DiagnosticCategory.Error, code: diagnosticCodes.compiler,
      source: diagnosticSource, messageText: diagnostic.message });
    return result;
  }

  function declarationFor(fn: ServerFunctionDefinition): ts.Node | undefined {
    for (const statement of sourceFile.statements) {
      if (typescript.isFunctionDeclaration(statement) && statement.name?.text === fn.local) return statement;
      if (typescript.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
        typescript.isIdentifier(declaration.name) && declaration.name.text === fn.local)) return statement;
    }
    return undefined;
  }

  function append(fn: ServerFunctionDefinition, tag: TypeCheckRange['tag'], check: string): void {
    const declaration = declarationFor(fn);
    const docTag = declaration === undefined ? undefined
      : typescript.getJSDocTags(declaration).find(candidate => candidate.tagName.text === tag);
    const authoredStart = docTag?.getStart(sourceFile) ?? declaration?.getStart(sourceFile) ?? 0;
    const authoredLength = docTag === undefined ? 1 : Math.max(1, docTag.end - authoredStart);
    const start = result.text.length;
    result.text += `\n{\n${check}\n}\n`;
    result.ranges.push({ start, end: result.text.length, authoredStart, authoredLength, tag });
  }

  // Avoid shadowing an authored annotation reference inside the synthetic block.
  let synthetic = '__mmd_annotation';
  while (authored.includes(synthetic)) synthetic += '_';
  const checkName = `${synthetic}_check`;
  const schemaName = `${synthetic}_schema`;
  const resultName = `${synthetic}_result`;
  const keysName = `${synthetic}_keys`;
  for (const fn of metadata.functions) {
    if (fn.middleware !== undefined) {
      const type = "ReadonlyArray<import('@memoized-dom/server').ServerMiddleware>";
      append(fn, 'middleware', /\.jsx?$/.test(file)
        ? `/** @type {${type}} */\nconst ${checkName} = (${fn.middleware});\nvoid ${checkName};`
        : `const ${checkName} = (${fn.middleware}) satisfies ${type};\nvoid ${checkName};`);
    }
    if (fn.input !== undefined) {
      const fields = fn.parameters.map((parameter, index) =>
        `${JSON.stringify(parameter.name)}${parameter.optional ? '?' : ''}: Parameters<typeof ${fn.local}>[${index}]`).join('; ');
      const names = fn.parameters.map(parameter => JSON.stringify(parameter.name)).join(' | ') || 'never';
      const type = `import('@memoized-dom/data').StandardSchemaV1<unknown, { ${fields} }>`;
      append(fn, 'Input', /\.jsx?$/.test(file)
        ? `/** @type {${type}} */\nconst ${schemaName} = (${fn.input});\nvoid ${schemaName};`
        : `const ${schemaName} = (${fn.input}) satisfies ${type};\ntype ${resultName} = Awaited<ReturnType<typeof ${schemaName}['~standard']['validate']>>;\ntype ${keysName}<Result> = Result extends { value: infer Output } ? keyof Output : never;\nconst ${keysName} = null as unknown as ${keysName}<${resultName}>;\n${keysName} satisfies ${names};\nvoid ${schemaName};`);
    }
  }
  return result;
}

/** Map failures in appended checks back to the corresponding authored tag. */
export function mapServerFunctionTypeDiagnostics(
  typescript: TypeScript,
  diagnostics: readonly ts.Diagnostic[],
  sources: ReadonlyMap<string, ServerFunctionTypeSource>,
): ts.Diagnostic[] {
  return diagnostics.map(diagnostic => {
    if (diagnostic.file === undefined || diagnostic.start === undefined) return diagnostic;
    const source = sources.get(normalizePath(diagnostic.file.fileName));
    if (source === undefined || diagnostic.start < source.authored.length) return diagnostic;
    const range = source.ranges.find(candidate => diagnostic.start! >= candidate.start && diagnostic.start! < candidate.end);
    if (range === undefined) return diagnostic;
    return {
      ...diagnostic,
      file: typescript.createSourceFile(diagnostic.file.fileName, source.authored, typescript.ScriptTarget.Latest, true),
      start: range.authoredStart, length: range.authoredLength,
      source: diagnosticSource,
      messageText: `@${range.tag}: ${typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    };
  });
}

/** Install an editor overlay without changing the files tsserver reads from disk. */
export function installServerFunctionTypeSnapshots(
  typescript: TypeScript,
  host: ts.LanguageServiceHost,
  options: ServerFunctionTypeOptions,
): Map<string, ServerFunctionTypeSource> {
  const sources = new Map<string, ServerFunctionTypeSource>();
  const snapshots = new WeakMap<ts.IScriptSnapshot, ts.IScriptSnapshot>();
  const getSnapshot = host.getScriptSnapshot.bind(host);
  const getVersion = host.getScriptVersion.bind(host);
  if (host.getProjectVersion !== undefined) {
    const getProjectVersion = host.getProjectVersion.bind(host);
    host.getProjectVersion = () => `${getProjectVersion()}:mmd-server-functions-v1`;
  }
  host.getScriptVersion = fileName => `${getVersion(fileName)}:mmd-server-functions-v1`;
  host.getScriptSnapshot = fileName => {
    const snapshot = getSnapshot(fileName);
    if (snapshot === undefined) {
      sources.delete(normalizePath(fileName));
      return undefined;
    }
    const cached = snapshots.get(snapshot);
    if (cached !== undefined) return cached;
    const source = serverFunctionTypeSource(typescript, fileName, snapshot.getText(0, snapshot.getLength()), options);
    if (source.ranges.length > 0 || source.diagnostics.length > 0) sources.set(normalizePath(fileName), source);
    else sources.delete(normalizePath(fileName));
    const augmented = source.text === source.authored ? snapshot : typescript.ScriptSnapshot.fromString(source.text);
    snapshots.set(snapshot, augmented);
    return augmented;
  };
  return sources;
}

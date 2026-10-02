import { dirname, resolve } from 'node:path';
import type * as ts from 'typescript';
import {
  mapServerFunctionTypeDiagnostics,
  serverFunctionTypeSource,
  type ServerFunctionTypeOptions,
  type ServerFunctionTypeSource,
} from './server-function-types';

type TypeScript = typeof ts;

/** Read-only project checking with the same annotation overlay used by tsserver. */
export function checkProject(
  typescript: TypeScript,
  configFile: string,
  overrides: ts.CompilerOptions = {},
  annotationOptions: ServerFunctionTypeOptions = {},
): ts.Diagnostic[] {
  const config = typescript.readConfigFile(configFile, typescript.sys.readFile);
  if (config.error !== undefined) return [config.error];
  const parsed = typescript.parseJsonConfigFileContent(config.config, typescript.sys,
    dirname(configFile), { ...overrides, noEmit: true }, configFile);
  if (parsed.errors.length > 0) return parsed.errors;
  const plugins = parsed.options.plugins as ts.PluginImport[] | undefined;
  const plugin = plugins?.find(candidate => candidate.name === '@memoized-dom/language-service') as
    (ServerFunctionTypeOptions & { name: string }) | undefined;
  const options = { ...plugin, ...annotationOptions };
  const host = typescript.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const sources = new Map<string, ServerFunctionTypeSource>();
  host.readFile = fileName => {
    const authored = readFile(fileName);
    if (authored === undefined) return undefined;
    const source = serverFunctionTypeSource(typescript, fileName, authored, options);
    if (source.ranges.length > 0 || source.diagnostics.length > 0) {
      sources.set(fileName.replaceAll('\\', '/'), source);
    }
    return source.text;
  };
  const program = typescript.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host,
  });
  return [
    ...mapServerFunctionTypeDiagnostics(typescript, typescript.getPreEmitDiagnostics(program), sources),
    ...[...sources.values()].flatMap(source => source.diagnostics),
  ];
}

export interface ProjectCheckResult {
  exitCode: number;
  output: string;
}

/** CLI parsing is separate from process I/O so terminal and CI behavior are testable. */
export function runProjectCheck(
  typescript: TypeScript,
  args: readonly string[],
  cwd = process.cwd(),
): ProjectCheckResult {
  if (args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, output: 'Usage: memoized-dom-check [-p tsconfig.json] [--server backend] [TypeScript options]\nChecks TypeScript and server-function annotations without emitting or modifying files.\n' };
  }
  const typescriptArgs: string[] = [];
  const options: ServerFunctionTypeOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--server') {
      const value = args[++index];
      if (value === undefined || value.startsWith('-')) return { exitCode: 1, output: '--server requires a folder path\n' };
      options.server = value;
    } else if (argument.startsWith('--server=')) options.server = argument.slice('--server='.length);
    else typescriptArgs.push(argument);
  }
  const command = typescript.parseCommandLine(typescriptArgs);
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => cwd,
    getNewLine: () => '\n',
  };
  const format = (diagnostics: readonly ts.Diagnostic[]) => command.options.pretty
    ? typescript.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)
    : typescript.formatDiagnostics(diagnostics, formatHost);
  if (command.errors.length > 0) return { exitCode: 1, output: format(command.errors) };
  if (command.fileNames.length > 0 || command.options.watch) {
    return { exitCode: 1, output: 'memoized-dom-check checks a project; use -p instead of file names. Watch mode is not supported.\n' };
  }
  let configFile = command.options.project === undefined
    ? typescript.findConfigFile(cwd, typescript.sys.fileExists)
    : resolve(cwd, command.options.project);
  if (configFile !== undefined && typescript.sys.directoryExists(configFile)) configFile = resolve(configFile, 'tsconfig.json');
  if (configFile === undefined) return { exitCode: 1, output: 'No tsconfig.json found; provide -p tsconfig.json\n' };
  const diagnostics = checkProject(typescript, configFile, command.options, options);
  return { exitCode: diagnostics.some(diagnostic => diagnostic.category === typescript.DiagnosticCategory.Error) ? 1 : 0,
    output: diagnostics.length === 0 ? 'TypeScript and server-function annotation checks passed.\n' : format(diagnostics) };
}

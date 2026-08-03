import type * as ts from 'typescript';
import {
  diagnoseModules,
  type CompilerDiagnostic,
} from '@memoized-dom/compiler';
import {
  diagnosticCodes,
  diagnosticSource,
} from './diagnostics/catalog';
import {
  collectPreferConstDiagnostics,
  createPreferConstCodeFix,
} from './diagnostics/prefer-const';

type TypeScript = typeof ts;

interface PluginConfig {
  preferConst?: boolean;
  compilerDiagnostics?: boolean;
}

export function createLanguageService(
  typescript: TypeScript,
  info: ts.server.PluginCreateInfo,
): ts.LanguageService {
  const original = info.languageService;
  const proxy = bindLanguageService(original);
  const config = info.config as PluginConfig;
  const preferConstCache = new WeakMap<
    ts.SourceFile,
    ts.DiagnosticWithLocation[]
  >();
  const compilerCache = new WeakMap<
    ts.Program,
    Map<string, ts.DiagnosticWithLocation[]>
  >();

  proxy.getSemanticDiagnostics = (fileName) => {
    const diagnostics = original.getSemanticDiagnostics(fileName);
    const program = original.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    if (program === undefined || sourceFile === undefined) {
      return diagnostics;
    }
    const customDiagnostics: ts.DiagnosticWithLocation[] = [];
    if (config.preferConst !== false) {
      let preferConst = preferConstCache.get(sourceFile);
      if (preferConst === undefined) {
        preferConst = collectPreferConstDiagnostics(
          typescript,
          program,
          sourceFile,
        );
        preferConstCache.set(sourceFile, preferConst);
      }
      customDiagnostics.push(...preferConst);
    }
    if (config.compilerDiagnostics !== false) {
      let byFile = compilerCache.get(program);
      if (byFile === undefined) {
        byFile = collectCompilerDiagnostics(
          typescript,
          program,
        );
        compilerCache.set(program, byFile);
      }
      customDiagnostics.push(...(byFile.get(normalizePath(fileName)) ?? []));
    }
    return [...diagnostics, ...customDiagnostics];
  };

  proxy.getCodeFixesAtPosition = (
    fileName,
    start,
    end,
    errorCodes,
    formatOptions,
    preferences,
  ) => {
    const fixes = original.getCodeFixesAtPosition(
      fileName,
      start,
      end,
      errorCodes,
      formatOptions,
      preferences,
    );
    if (
      config.preferConst === false ||
      !errorCodes.includes(diagnosticCodes.preferConst)
    ) {
      return fixes;
    }
    const sourceFile = original.getProgram()?.getSourceFile(fileName);
    if (sourceFile === undefined) return fixes;
    const fix = createPreferConstCodeFix(
      typescript,
      sourceFile,
      start,
    );
    return fix === null ? fixes : [...fixes, fix];
  };

  return proxy;
}

function collectCompilerDiagnostics(
  typescript: TypeScript,
  program: ts.Program,
): Map<string, ts.DiagnosticWithLocation[]> {
  const sourceFiles = program.getSourceFiles().filter(
    (sourceFile) =>
      !sourceFile.isDeclarationFile &&
      !normalizePath(sourceFile.fileName).includes('/node_modules/') &&
      /\.[jt]sx?$/.test(sourceFile.fileName),
  );
  const modules = Object.fromEntries(
    sourceFiles.map((sourceFile) => [
      normalizePath(sourceFile.fileName),
      sourceFile.text,
    ]),
  );
  const diagnostics = diagnoseModules(modules, {
    resolveImport(specifier, importer) {
      const resolution = typescript.resolveModuleName(
        specifier,
        importer,
        program.getCompilerOptions(),
        typescript.sys,
      ).resolvedModule;
      if (resolution === undefined) return undefined;
      const resolved = normalizePath(resolution.resolvedFileName);
      return Object.hasOwn(modules, resolved) ? resolved : undefined;
    },
  });
  const byFile = new Map<string, ts.DiagnosticWithLocation[]>();
  for (const diagnostic of diagnostics) {
    const moduleId = diagnostic.moduleId;
    const sourceFile =
      moduleId === undefined
        ? sourceFiles[0]
        : sourceFiles.find(
            (candidate) => normalizePath(candidate.fileName) === moduleId,
          );
    if (sourceFile === undefined) continue;
    const converted = compilerDiagnostic(
      typescript,
      sourceFile,
      diagnostic,
    );
    const key = normalizePath(sourceFile.fileName);
    const list = byFile.get(key) ?? [];
    list.push(converted);
    byFile.set(key, list);
  }
  return byFile;
}

function compilerDiagnostic(
  typescript: TypeScript,
  sourceFile: ts.SourceFile,
  diagnostic: CompilerDiagnostic,
): ts.DiagnosticWithLocation {
  const start = diagnosticStart(sourceFile, diagnostic);
  return {
    file: sourceFile,
    start,
    length: Math.min(1, Math.max(0, sourceFile.text.length - start)),
    category: typescript.DiagnosticCategory.Error,
    code: diagnosticCodes.compiler,
    source: diagnosticSource,
    messageText: diagnostic.message,
  };
}

function diagnosticStart(
  sourceFile: ts.SourceFile,
  diagnostic: CompilerDiagnostic,
): number {
  if (diagnostic.line !== undefined && diagnostic.column !== undefined) {
    const line = Math.max(0, diagnostic.line - 1);
    if (line < sourceFile.getLineStarts().length) {
      return sourceFile.getPositionOfLineAndCharacter(line, diagnostic.column);
    }
  }
  const binding = diagnostic.message.match(/'([^']+)'/)?.[1];
  if (binding !== undefined) {
    const position = sourceFile.text.indexOf(binding);
    if (position !== -1) return position;
  }
  return 0;
}

function normalizePath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function bindLanguageService(
  languageService: ts.LanguageService,
): ts.LanguageService {
  const proxy = Object.create(null) as ts.LanguageService;
  const writable = proxy as unknown as Record<string, unknown>;
  for (const key of Object.keys(languageService) as Array<
    keyof ts.LanguageService
  >) {
    const member = languageService[key];
    if (typeof member === 'function') {
      writable[key] = (
        ...args: unknown[]
      ) => (member as (...values: unknown[]) => unknown).apply(
        languageService,
        args,
      );
    } else {
      writable[key] = member;
    }
  }
  return proxy;
}

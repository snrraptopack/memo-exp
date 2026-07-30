import type * as ts from 'typescript';
import { diagnosticCodes } from './diagnostics/catalog';
import {
  collectPreferConstDiagnostics,
  createPreferConstCodeFix,
} from './diagnostics/prefer-const';

type TypeScript = typeof ts;

interface PluginConfig {
  preferConst?: boolean;
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

  proxy.getSemanticDiagnostics = (fileName) => {
    const diagnostics = original.getSemanticDiagnostics(fileName);
    if (config.preferConst === false) return diagnostics;
    const program = original.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    if (program === undefined || sourceFile === undefined) {
      return diagnostics;
    }
    let customDiagnostics = preferConstCache.get(sourceFile);
    if (customDiagnostics === undefined) {
      customDiagnostics = collectPreferConstDiagnostics(
        typescript,
        program,
        sourceFile,
      );
      preferConstCache.set(sourceFile, customDiagnostics);
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

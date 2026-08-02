import { compile, type MemoDomOptions } from './compile';
import {
  compileModules,
  type CompileModulesOptions,
} from './linker';

export const compilerDiagnosticCode = 98000;
export const compilerDiagnosticSource = 'memoized-dom';

export interface CompilerDiagnostic {
  code: typeof compilerDiagnosticCode;
  source: typeof compilerDiagnosticSource;
  severity: 'error';
  message: string;
  moduleId?: string;
  line?: number;
  column?: number;
}

interface ErrorLike {
  message?: unknown;
  loc?: { line?: unknown; column?: unknown };
}

function normalizedId(id: string): string {
  return id.replaceAll('\\', '/').replace(/^\.\//, '');
}

function moduleFromPrefix(
  prefix: string,
  moduleIds: readonly string[],
): string | undefined {
  const normalizedPrefix = normalizedId(prefix);
  return [...moduleIds]
    .sort((left, right) => right.length - left.length)
    .find((id) => normalizedPrefix.endsWith(normalizedId(id)));
}

/** Convert every compiler failure into the package's stable feedback shape. */
export function toCompilerDiagnostic(
  value: unknown,
  moduleIds: readonly string[] = [],
): CompilerDiagnostic {
  const error = value as ErrorLike;
  const raw =
    typeof error?.message === 'string' ? error.message : String(value);
  const marker = raw.indexOf(': memo-dom:');
  const parseLocation = raw.match(/\((\d+):(\d+)\)/);
  const loc = error?.loc;
  const line =
    typeof loc?.line === 'number'
      ? loc.line
      : parseLocation === null
        ? undefined
        : Number(parseLocation[1]);
  const column =
    typeof loc?.column === 'number'
      ? loc.column
      : parseLocation === null
        ? undefined
        : Number(parseLocation[2]);
  const prefix = marker === -1 ? '' : raw.slice(0, marker);
  const moduleId =
    moduleFromPrefix(prefix, moduleIds) ??
    (moduleIds.length === 1 ? moduleIds[0] : undefined);
  const message = marker === -1 ? raw : raw.slice(marker + 2);
  return {
    code: compilerDiagnosticCode,
    source: compilerDiagnosticSource,
    severity: 'error',
    message,
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

export function diagnose(
  source: string,
  options: MemoDomOptions = {},
): CompilerDiagnostic[] {
  try {
    compile(source, options);
    return [];
  } catch (error) {
    return [
      toCompilerDiagnostic(error, [options.moduleId ?? './component.tsx']),
    ];
  }
}

export function diagnoseModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): CompilerDiagnostic[] {
  try {
    compileModules(modules, options);
    return [];
  } catch (error) {
    return [toCompilerDiagnostic(error, Object.keys(modules))];
  }
}

import type { BaseNode } from './ast';

export interface CompilerErrorLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/** Anything carrying an authored ESTree source location, including synthetic anchors. */
export interface CompilerErrorAnchor {
  readonly loc?: {
    readonly start?: { readonly line: number; readonly column: number };
    readonly end?: { readonly line: number; readonly column: number };
  } | null;
}

/** Compiler-owned error carrying an authored ESTree source location. */
export class MemoizedDomCompilerError extends Error {
  readonly moduleId?: string;
  readonly loc?: CompilerErrorLocation;

  constructor(
    message: string,
    moduleId?: string,
    at?: BaseNode | CompilerErrorAnchor | null,
  ) {
    super(message);
    this.name = 'MemoizedDomCompilerError';
    this.moduleId = moduleId;
    const start = at?.loc?.start;
    if (start !== undefined) {
      const end = at?.loc?.end;
      this.loc = {
        line: start.line,
        column: start.column,
        ...(end === undefined
          ? {}
          : { endLine: end.line, endColumn: end.column }),
      };
    }
  }
}

export function compilerError(
  message: string,
  moduleId?: string,
  at?: BaseNode | CompilerErrorAnchor | null,
): MemoizedDomCompilerError {
  return new MemoizedDomCompilerError(message, moduleId, at);
}

import type { BaseNode } from './ast';

export interface CompilerErrorLocation {
  line: number;
  column: number;
}

/** Compiler-owned error carrying an authored ESTree source location. */
export class MemoizedDomCompilerError extends Error {
  readonly moduleId?: string;
  readonly loc?: CompilerErrorLocation;

  constructor(message: string, moduleId?: string, at?: BaseNode | null) {
    super(message);
    this.name = 'MemoizedDomCompilerError';
    this.moduleId = moduleId;
    const start = at?.loc?.start;
    if (start !== undefined) {
      this.loc = { line: start.line, column: start.column };
    }
  }
}

export function compilerError(
  message: string,
  moduleId?: string,
  at?: BaseNode | null,
): MemoizedDomCompilerError {
  return new MemoizedDomCompilerError(message, moduleId, at);
}

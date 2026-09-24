/** Public compiler entry point: frontend ESTree in, compiler transform, Esrap out. */

import type * as t from './ast/compiler-types';
import {
  cloneNode,
  parseWithEstreeFrontendOrThrow,
  printEstree,
  stripTypeScript,
  type AstComment,
  type BaseNode,
  type EstreeFrontend,
  type Program,
  memoizedEstreeFrontend,
} from './ast';
import {
  transformEstreeProgram,
  type MemoDomOptions,
} from './plugin';
import type { InternalMemoDomOptions } from './context';
import { compilerError } from './errors';

export type { MemoDomOptions };

export interface CompilerSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
}

export interface CompiledSource {
  code: string;
  map: CompilerSourceMap;
  css?: string;
}

export interface CompileOptions extends MemoDomOptions {
  /** Parser adapter. The default selects TSRX or Yuku from the source extension. */
  frontend?: EstreeFrontend;
}

interface CompilerInput {
  program: Program;
  comments: readonly AstComment[];
  css?: string;
}

function inputProgram(
  source: string,
  moduleId: string,
  frontend: EstreeFrontend,
  ast?: t.File | t.Program,
  comments: readonly AstComment[] = [],
): CompilerInput {
  if (ast !== undefined) {
    const program = ast.type === 'File' ? ast.program : ast;
    return {
      program: cloneNode(program as unknown as BaseNode) as Program,
      comments,
    };
  }
  const parsed = parseWithEstreeFrontendOrThrow(frontend, source, {
    filename: moduleId,
    sourceType: 'module',
  });
  return {
    program: parsed.program as unknown as Program,
    comments: parsed.comments,
    css: parsed.css,
  };
}

function transform(
  source: string,
  opts: InternalMemoDomOptions,
  sourceMaps: boolean,
  ast?: t.File | t.Program,
  frontend: EstreeFrontend = memoizedEstreeFrontend,
  comments: readonly AstComment[] = [],
): { code: string; map: CompilerSourceMap | null; css?: string } {
  const moduleId = opts.moduleId ?? './component.tsx';
  const input = inputProgram(source, moduleId, frontend, ast, comments);
  transformEstreeProgram(
    {
      node: input.program,
      buildCodeFrameError(message: string, at = input.program) {
        return compilerError(
          message,
          moduleId,
          at as unknown as BaseNode,
        );
      },
    },
    opts,
  );
  const program = stripTypeScript(input.program);
  const printed = printEstree(program, {
    comments: input.comments,
    ...(sourceMaps
      ? { sourceMapSource: moduleId, sourceMapContent: source }
      : {}),
  });
  return {
    code: printed.code,
    map: printed.map === null
      ? null
      : {
          ...printed.map,
          sources: printed.map.sources.map((sourceName) => sourceName ?? moduleId),
        },
    ...(input.css ? { css: input.css } : {}),
  };
}

/** Compile source while preserving the historical string-only API. */
export function compile(source: string, opts: CompileOptions = {}): string {
  const { frontend = memoizedEstreeFrontend, ...compilerOptions } = opts;
  return transform(source, compilerOptions, false, undefined, frontend).code;
}

/** Internal linked-graph path that reuses an ESTree program. */
export function compileAst(
  source: string,
  opts: InternalMemoDomOptions,
  ast?: t.File | t.Program,
  comments: readonly AstComment[] = [],
): string {
  return transform(source, opts, false, ast, memoizedEstreeFrontend, comments).code;
}

/** Compile source and return a source map back to the authored TSX module. */
export function compileDetailed(
  source: string,
  opts: CompileOptions = {},
): CompiledSource {
  const { frontend = memoizedEstreeFrontend, ...compilerOptions } = opts;
  const out = transform(source, compilerOptions, true, undefined, frontend);
  if (out.map === null) {
    throw new Error('memo-dom: compilation produced no source map');
  }
  return { code: out.code, map: out.map, ...(out.css ? { css: out.css } : {}) };
}

/** Internal linked-graph path that reuses a cached ESTree program. */
export function compileAstDetailed(
  source: string,
  opts: InternalMemoDomOptions,
  ast?: t.File | t.Program,
  comments: readonly AstComment[] = [],
): CompiledSource {
  const out = transform(source, opts, true, ast, memoizedEstreeFrontend, comments);
  if (out.map === null) {
    throw new Error('memo-dom: compilation produced no source map');
  }
  return { code: out.code, map: out.map, ...(out.css ? { css: out.css } : {}) };
}

/**
 * compile.ts — compiler entry point.
 *
 * One function: component source (.tsx) in, compiled JavaScript out.
 *
 * Plugin pipeline:
 *   1. @babel/plugin-syntax-jsx           — parse JSX (no transform)
 *   2. memoDomPlugin                      — the paradigm transform (R1–R6, L1)
 *   3. @babel/plugin-transform-typescript — strip types from emitted code
 *
 * The transform is written against standard ESTree nodes via @babel/types so
 * frontend #2 (oxc) can reuse the emission logic later.
 */

import {
  transformFromAstSync,
  transformSync,
  type InputOptions,
} from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import transformTypescript from '@babel/plugin-transform-typescript';
import * as t from '@babel/types';
import memoDomPlugin, { type MemoDomOptions } from './plugin';
import type { InternalMemoDomOptions } from './context';

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
}

function transform(
  source: string,
  opts: InternalMemoDomOptions,
  sourceMaps: boolean,
  ast?: t.File,
): ReturnType<typeof transformSync> {
  const moduleId = opts.moduleId ?? './component.tsx';
  const transformOptions: InputOptions = {
    filename: moduleId,
    sourceFileName: moduleId,
    sourceMaps,
    plugins: [
      [syntaxJsx as any, {}],
      [memoDomPlugin, opts],
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  };
  return ast === undefined
    ? transformSync(source, transformOptions)
    : transformFromAstSync(t.cloneNode(ast, true), source, transformOptions);
}

/** Compile source while preserving the historical string-only API. */
export function compile(source: string, opts: MemoDomOptions = {}): string {
  return compileAst(source, opts);
}

/** Internal linked-graph path that reuses an AST without producing a map. */
export function compileAst(
  source: string,
  opts: InternalMemoDomOptions,
  ast?: t.File,
): string {
  const out = transform(source, opts, false, ast);
  if (!out || out.code == null) {
    throw new Error('memo-dom: compilation produced no output');
  }
  return out.code;
}

/** Compile source and return a source map back to the authored TSX module. */
export function compileDetailed(
  source: string,
  opts: MemoDomOptions = {},
): CompiledSource {
  return compileAstDetailed(source, opts);
}

/** Internal linked-graph path that reuses a cached parsed module AST. */
export function compileAstDetailed(
  source: string,
  opts: InternalMemoDomOptions,
  ast?: t.File,
): CompiledSource {
  const out = transform(source, opts, true, ast);
  if (!out || out.code == null || out.map == null) {
    throw new Error('memo-dom: compilation produced no output or source map');
  }
  return {
    code: out.code,
    map: out.map as CompilerSourceMap,
  };
}

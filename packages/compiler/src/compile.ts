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

import { transformSync } from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import transformTypescript from '@babel/plugin-transform-typescript';
import memoDomPlugin, { type MemoDomOptions } from './plugin';

export type { MemoDomOptions };

export function compile(source: string, opts: MemoDomOptions = {}): string {
  const out = transformSync(source, {
    filename: opts.moduleId ?? './component.tsx',
    plugins: [
      [syntaxJsx as any, {}],
      [memoDomPlugin, opts],
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  });
  if (!out || out.code == null) {
    throw new Error('memo-dom: compilation produced no output');
  }
  return out.code;
}

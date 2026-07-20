/**
 * plugin.ts — the memo-dom Babel plugin (compiler frontend #1), thin shell.
 *
 * Implements emission spec R1–R7 at analysis level L1; the work lives in:
 *   context.ts   — shared state + AST helpers
 *   analysis.ts  — pass 1: state/components/composition/reads + access table
 *   handlers.ts  — R5: per-scope write analysis and commit emission
 *   lists.ts     — R7: map-site analysis and validation
 *   emit.ts      — R1–R4/R7 emission: components and rows → entity factories
 *
 * L1 limitations (clear compile errors by design):
 *   - components must be top-level `function` declarations (no arrows)
 *   - exactly one top-level JSX return per component
 *   - no fragments, no spread attributes, no children props
 *   - no conditional JSX (R8 is an open spec decision)
 *   - no lists inside list rows
 */

import type { Visitor } from '@babel/traverse';
import * as t from '@babel/types';
import { createCtx, type MemoDomOptions } from './context';
import { buildAccessTable, runAnalysis } from './analysis';
import { transformComponent } from './emit';

export type { MemoDomOptions };

export default function memoDomPlugin(
  _api: unknown,
  opts: MemoDomOptions = {},
): { name: string; visitor: Visitor } {
  const ctx = createCtx(opts);
  const transformed = new WeakSet<t.Node>();

  const visitor: Visitor = {
    Program: {
      enter(programPath) {
        runAnalysis(ctx, programPath);
      },
      exit(programPath) {
        // safety net: any JSX left over lived outside a component function
        programPath.traverse({
          JSXElement(p) {
            throw p.buildCodeFrameError(
              'memo-dom: JSX outside a component function — components must be top-level function declarations (L1)',
            );
          },
        });

        const table = buildAccessTable(ctx);
        if (table) ctx.header.push(table);

        // flush header (write consts, access table) right after the import
        for (let i = ctx.header.length - 1; i >= 0; i--) {
          programPath.unshiftContainer('body', ctx.header[i]!);
        }
        programPath.unshiftContainer(
          'body',
          t.importDeclaration(
            [t.importNamespaceSpecifier(t.identifier('MD'))],
            t.stringLiteral(ctx.runtimePath),
          ),
        );
      },
    },

    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (!name || !ctx.comps.has(name) || transformed.has(path.node)) return;
      transformed.add(path.node);
      transformComponent(ctx, path, name);
      path.skip();
    },
  };

  return { name: 'memo-dom', visitor };
}

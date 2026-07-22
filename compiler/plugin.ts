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
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { createCtx, freshWriteConst, md, type Ctx, type MemoDomOptions } from './context';
import { buildAccessTable, runAnalysis } from './analysis';
import { transformComponent } from './emit';

/**
 * R13: rewrite each computed declaration (`const x = <state derivation>`)
 * into a `let` plus a depth-(-1) entity whose render recomputes and commits
 * 'x' downstream ONLY when the value actually changed (computedChanged).
 * Depth -1 guarantees the recompute renders BEFORE any reader in a commit.
 */
function rewriteComputeds(ctx: Ctx, programPath: NodePath<t.Program>): void {
  for (const stmtPath of programPath.get('body')) {
    let declNode: t.Node | null | undefined = stmtPath.node;
    if (t.isExportNamedDeclaration(declNode)) declNode = declNode.declaration;
    if (!t.isVariableDeclaration(declNode) || declNode.kind !== 'const') continue;
    for (const d of declNode.declarations) {
      if (!t.isIdentifier(d.id) || d.init == null) continue;
      const name = d.id.name;
      if (!ctx.computeds.has(name)) continue;
      declNode.kind = 'let';
      const init = t.cloneNode(d.init);
      const registerStmt = t.expressionStatement(
        t.callExpression(md('register'), [
          t.objectExpression([
            t.objectProperty(
              t.identifier('id'),
              t.stringLiteral(`${ctx.rootId}/$computed/${name}`),
            ),
            t.objectProperty(t.identifier('parent'), t.nullLiteral()),
            t.objectProperty(
              t.identifier('depth'),
              t.unaryExpression('-', t.numericLiteral(1)),
            ),
            t.objectProperty(
              t.identifier('render'),
              t.arrowFunctionExpression(
                [],
                t.blockStatement([
                  t.variableDeclaration('const', [
                    t.variableDeclarator(t.identifier('next'), init),
                  ]),
                  t.ifStatement(
                    t.callExpression(md('computedChanged'), [
                      t.identifier(name),
                      t.identifier('next'),
                    ]),
                    t.blockStatement([
                      t.expressionStatement(
                        t.assignmentExpression('=', t.identifier(name), t.identifier('next')),
                      ),
                      t.expressionStatement(
                        t.callExpression(md('commitWrites'), [freshWriteConst(ctx, [name])]),
                      ),
                    ]),
                  ),
                ]),
              ),
            ),
          ]),
        ]),
      );
      stmtPath.insertAfter(registerStmt);
    }
  }
}

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
        if (ctx.computeds.size > 0) rewriteComputeds(ctx, programPath); // R13
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

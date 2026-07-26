/**
 * plugin.ts — the memo-dom Babel plugin (compiler frontend #1), thin shell.
 *
 * Coordinates the emission-spec passes; implementation is partitioned into:
 *   context.ts              - shared binding and canonical identity facts
 *   analysis.ts             - module/component/read analysis and access table
 *   handlers.ts             - per-scope effects and commit emission
 *   emission/component.ts   - source components to runtime factories
 *   emit.ts                 - DOM nodes and structural regions
 *   components/ and jsx/    - prop/slot contracts and authored JSX semantics
 *
 * L1 limitations (clear compile errors by design):
 *   - components must be top-level `function` declarations (no arrows)
 *   - exactly one top-level JSX return per component
 *   - spread attributes preserve overrides through general DOM patching
 *   - children slots mount once at a direct host insertion point
 *   - conditional JSX uses the restricted R8 region forms
 *   - no lists inside list rows
 */

import type { Visitor } from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  createCtx,
  freshWriteConst,
  type Ctx,
  type MemoDomOptions,
} from './context';
import {
  generatedIdentifier,
  initializeGeneratedIdentifiers,
  md,
  requireIdentifiers,
} from './identifiers';
import { buildAccessTable, runAnalysis } from './analysis';
import { transformComponent } from './emission/component';
import {
  rejectUnownedCleanup,
  transformProgramCallbacks,
  transformSharedAsyncHelpers,
} from './lifecycle';

/**
 * R13: rewrite each computed declaration (`const x = <state derivation>`)
 * into a `let` plus a depth-(-1) entity whose render recomputes and commits
 * 'x' downstream ONLY when the value actually changed (computedChanged).
 * Depth -1 guarantees the recompute renders BEFORE any reader in a commit.
 */
function rewriteComputeds(ctx: Ctx, programPath: NodePath<t.Program>): void {
  const computedPrefix = `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#`;
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
      const next = generatedIdentifier(ctx, `${name}Next`);
      const registerStmt = t.expressionStatement(
        t.callExpression(md(ctx, 'register'), [
          t.objectExpression([
            t.objectProperty(
              t.identifier('id'),
              t.stringLiteral(`${computedPrefix}${name}`),
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
                    t.variableDeclarator(next, init),
                  ]),
                  t.ifStatement(
                    t.callExpression(md(ctx, 'computedChanged'), [
                      t.identifier(name),
                      t.cloneNode(next),
                    ]),
                    t.blockStatement([
                      t.expressionStatement(
                        t.assignmentExpression('=', t.identifier(name), t.cloneNode(next)),
                      ),
                      t.expressionStatement(
                        t.callExpression(md(ctx, 'commitWrites'), [freshWriteConst(ctx, [name])]),
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
        initializeGeneratedIdentifiers(ctx, programPath);
        runAnalysis(ctx, programPath);
        transformProgramCallbacks(ctx, programPath);
        transformSharedAsyncHelpers(ctx);
      },
      exit(programPath) {
        rejectUnownedCleanup(programPath);

        // safety net: any JSX left over lived outside a component function
        programPath.traverse({
          JSXElement(p) {
            throw p.buildCodeFrameError(
              'memo-dom: JSX outside a component function — components must be top-level function declarations (L1)',
            );
          },
          JSXFragment(p) {
            throw p.buildCodeFrameError(
              'memo-dom: JSX outside a component function - components must be top-level function declarations',
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
            [
              t.importNamespaceSpecifier(
                t.identifier(requireIdentifiers(ctx).runtimeId),
              ),
            ],
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

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
 *   - direct JSX returns plus R27 structural tail-return control flow
 *   - spread attributes preserve overrides through general DOM patching
 *   - children slots mount once at a direct host insertion point
 *   - conditional JSX uses anchored R8/R27 regions
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
import { rejectUnownedEffects } from './effects';

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

function rewriteModuleControlFlow(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  const paths = new Map(
    programPath.get('body').map((statementPath) => [
      statementPath.node,
      statementPath,
    ]),
  );
  for (const flow of ctx.moduleControlFlow) {
    const statementPath = paths.get(flow.statement);
    if (statementPath === undefined) continue;
    const previous = new Map(
      flow.bindings.map((binding) => [
        binding,
        generatedIdentifier(ctx, `${binding}Previous`),
      ]),
    );
    const renderBody: t.Statement[] = [
      t.variableDeclaration(
        'const',
        flow.bindings.map((binding) =>
          t.variableDeclarator(
            t.cloneNode(previous.get(binding)!),
            t.identifier(binding),
          ),
        ),
      ),
      t.cloneNode(flow.statement, true),
      ...flow.bindings.map((binding) =>
        t.ifStatement(
          t.callExpression(md(ctx, 'computedChanged'), [
            t.cloneNode(previous.get(binding)!),
            t.identifier(binding),
          ]),
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(md(ctx, 'commitWrites'), [
                freshWriteConst(ctx, [binding]),
              ]),
            ),
          ]),
        ),
      ),
    ];
    statementPath.insertAfter(
      t.expressionStatement(
        t.callExpression(md(ctx, 'register'), [
          t.objectExpression([
            t.objectProperty(
              t.identifier('id'),
              t.stringLiteral(flow.entityId),
            ),
            t.objectProperty(t.identifier('parent'), t.nullLiteral()),
            t.objectProperty(
              t.identifier('depth'),
              t.unaryExpression('-', t.numericLiteral(1)),
            ),
            t.objectProperty(
              t.identifier('render'),
              t.arrowFunctionExpression([], t.blockStatement(renderBody)),
            ),
          ]),
        ]),
      ),
    );
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
        rejectUnownedEffects(programPath);

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
        if (ctx.moduleControlFlow.length > 0) {
          rewriteModuleControlFlow(ctx, programPath);
        }
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

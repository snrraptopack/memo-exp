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
 * Source-shape constraints use clear compile errors by design. Top-level
 * function declarations and synchronous uppercase const function expressions
 * are components; JSX return control flow, repeated render slots, and nested
 * row composition are normalized before the core analysis/emission passes.
 */

import type { PluginObject } from '@babel/core';
import * as t from '@babel/types';
import { walkAst, type BaseNode } from './ast';
import {
  createCtx,
  freshWriteConst,
  type Ctx,
  type InternalMemoDomOptions,
  type MemoDomOptions,
} from './context';
import {
  generatedIdentifier,
  initializeGeneratedIdentifiers,
  md,
  requireIdentifiers,
} from './identifiers';
import { buildAccessTable, runAnalysis } from './analysis';
import { liftModuleStateCells } from './cells';
import { transformComponent } from './emission/component';
import {
  rejectUnownedCleanup,
  transformProgramCallbacks,
  transformSharedAsyncHelpers,
} from './lifecycle';
import {
  rejectUnownedEffects,
  rewriteModuleEffects,
} from './effects';
import { installLinkedDynamicComponentImports } from './jsx/dynamic-tags';
import { normalizeComponentDeclarations } from './components/declarations';
import {
  analyzeRouterJsx,
  routeManifestStatements,
} from './router';
import { normalizeConditionalJsxDirectives } from './jsx/conditional-directives';
import {
  lowerTransparentGroups,
  rewriteTransparentDataReads,
  scanAndLowerModuleSourceDeclarations,
  scanTransparentSourceImports,
} from './data-sources';

/**
 * R13: rewrite each computed declaration (`const x = <state derivation>`)
 * into a `let` plus a depth-(-1) entity whose render recomputes and commits
 * 'x' downstream ONLY when the value actually changed (computedChanged).
 * Depth -1 guarantees the recompute renders BEFORE any reader in a commit.
 */
function rewriteComputeds(ctx: Ctx, program: t.Program): void {
  const computedPrefix = `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#`;
  for (let statementIndex = 0; statementIndex < program.body.length; statementIndex++) {
    const statement = program.body[statementIndex]!;
    let declNode: t.Node | null | undefined = statement;
    if (t.isExportNamedDeclaration(declNode)) declNode = declNode.declaration;
    if (!t.isVariableDeclaration(declNode) || declNode.kind !== 'const') continue;
    const registrations: t.Statement[] = [];
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
      registrations.push(registerStmt);
    }
    if (registrations.length > 0) {
      program.body.splice(statementIndex + 1, 0, ...registrations);
      statementIndex += registrations.length;
    }
  }
}

function rewriteModuleControlFlow(
  ctx: Ctx,
  program: t.Program,
): void {
  for (const flow of ctx.moduleControlFlow) {
    const statementIndex = program.body.indexOf(flow.statement);
    if (statementIndex === -1) continue;
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
    program.body.splice(
      statementIndex + 1,
      0,
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

interface ProgramDiagnostic {
  node: t.Program;
  buildCodeFrameError(message: string): Error;
}

function rejectLeftoverJsx(ctx: Ctx, programPath: ProgramDiagnostic): void {
  const analysis = ctx.astAnalysis;
  if (analysis === null) return;

  const describeOwner = (node: BaseNode): string => {
    let current = analysis.parentByNode.get(node) ?? null;
    while (current !== null) {
      if (current.type === 'FunctionDeclaration') {
        const id = (current as unknown as { id?: BaseNode | null }).id;
        if (id?.type === 'Identifier') {
          const name = (id as unknown as { name: string }).name;
          return ` in component '${name}'`;
        }
      }
      current = analysis.parentByNode.get(current) ?? null;
    }
    return ' at module scope';
  };

  const location = (node: BaseNode): string | null => {
    let current: BaseNode | null = node;
    while (current !== null) {
      if (current.loc !== null && current.loc !== undefined) {
        return `${current.loc.start.line}:${current.loc.start.column + 1}`;
      }
      current = analysis.parentByNode.get(current) ?? null;
    }
    return null;
  };

  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
      const at = location(node);
      let leftover = 'fragment';
      if (node.type === 'JSXElement') {
        const opening = (node as unknown as t.JSXElement).openingElement;
        leftover = t.isJSXIdentifier(opening.name)
          ? `<${opening.name.name}>`
          : '<element>';
      }
      throw programPath.buildCodeFrameError(
        `memo-dom: JSX outside a component or compile-time render helper — leftover ${leftover}${describeOwner(node)}${
          at === null ? '' : ` near ${at}`
        }; components must use a supported top-level declaration`,
      );
    },
  });
}

export type { MemoDomOptions };

export default function memoDomPlugin(
  _api: unknown,
  opts: InternalMemoDomOptions = {},
): PluginObject {
  const ctx = createCtx(opts);
  const transformed = new WeakSet<t.Node>();

  const visitor: NonNullable<PluginObject['visitor']> = {
    Program: {
      enter(programPath) {
        normalizeComponentDeclarations(programPath);
        installLinkedDynamicComponentImports(ctx, programPath);
        normalizeConditionalJsxDirectives(programPath);
        initializeGeneratedIdentifiers(ctx, programPath.node);
        scanTransparentSourceImports(ctx, programPath);
        lowerTransparentGroups(ctx, programPath);
        scanAndLowerModuleSourceDeclarations(ctx, programPath);
        analyzeRouterJsx(ctx, programPath);
        runAnalysis(ctx, programPath);
        rewriteTransparentDataReads(ctx);
        transformProgramCallbacks(ctx, programPath);
        transformSharedAsyncHelpers(ctx);
      },
      exit(programPath) {
        liftModuleStateCells(ctx, programPath);
        rewriteModuleEffects(ctx, programPath);
        rejectUnownedCleanup(ctx, programPath);
        rejectUnownedEffects(ctx, programPath);
        ctx.header.unshift(...routeManifestStatements(ctx));

        // safety net: any JSX left over lived outside a component function.
        // Synthetic nodes created by transforms carry no loc, so walk up to
        // the nearest ancestor that does; without this Babel degrades to the
        // useless "internal node" message and users cannot locate the site.
        rejectLeftoverJsx(ctx, programPath);

        const table = buildAccessTable(ctx);
        if (ctx.computeds.size > 0) rewriteComputeds(ctx, programPath.node); // R13
        if (ctx.moduleControlFlow.length > 0) {
          rewriteModuleControlFlow(ctx, programPath.node);
        }
        if (table) ctx.header.push(table);

        // flush header (write consts, access table) right after the import
        for (let i = ctx.header.length - 1; i >= 0; i--) {
          programPath.unshiftContainer('body', ctx.header[i]!);
        }
        const imports = [
          t.importDeclaration(
            [
              t.importNamespaceSpecifier(
                t.identifier(requireIdentifiers(ctx).runtimeId),
              ),
            ],
            t.stringLiteral(ctx.runtimePath),
          ),
        ];
        if (ctx.usesRouter) {
          imports.push(
            t.importDeclaration(
              [
                t.importNamespaceSpecifier(
                  t.identifier(requireIdentifiers(ctx).routerId),
                ),
              ],
              t.stringLiteral(ctx.routerPath),
            ),
          );
        }
        if (ctx.usesTransparentData) {
          imports.push(
            t.importDeclaration(
              [
                t.importNamespaceSpecifier(
                  t.identifier(requireIdentifiers(ctx).dataRuntimeId),
                ),
              ],
              t.stringLiteral(ctx.dataRuntimePath),
            ),
          );
        }
        programPath.unshiftContainer('body', imports);
        if (ctx.rootComponent !== null) {
          programPath.pushContainer(
            'body',
            t.expressionStatement(
              t.callExpression(md(ctx, 'registerRootFactory'), [
                t.identifier(ctx.rootComponent),
                t.objectExpression([
                  t.objectProperty(t.identifier('id'), t.stringLiteral(ctx.rootId)),
                  t.objectProperty(
                    t.identifier('create'),
                    t.arrowFunctionExpression(
                      [],
                      t.callExpression(t.identifier(ctx.rootComponent), [
                        t.stringLiteral(ctx.rootId),
                        t.nullLiteral(),
                        t.arrayExpression([]),
                      ]),
                    ),
                  ),
                ]),
              ]),
            ),
          );
        }
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

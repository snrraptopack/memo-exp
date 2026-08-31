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
import { cloneNode as cloneEstreeNode } from './ast';
import {
  normalizeEstreeDialect,
  walkAst,
  type BaseNode,
} from './ast';
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
      const init = cloneEstreeNode(d.init);
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
                      cloneEstreeNode(next),
                    ]),
                    t.blockStatement([
                      t.expressionStatement(
                        t.assignmentExpression('=', t.identifier(name), cloneEstreeNode(next)),
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
            cloneEstreeNode(previous.get(binding)!),
            t.identifier(binding),
          ),
        ),
      ),
      cloneEstreeNode(flow.statement, true),
      ...flow.bindings.map((binding) =>
        t.ifStatement(
          t.callExpression(md(ctx, 'computedChanged'), [
            cloneEstreeNode(previous.get(binding)!),
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

export interface ProgramTransformPath extends ProgramDiagnostic {}

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

function prepareProgram(
  ctx: Ctx,
  programPath: ProgramTransformPath,
): void {
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
}

function finishProgram(ctx: Ctx, programPath: ProgramTransformPath): void {
  liftModuleStateCells(ctx, programPath);
  rewriteModuleEffects(ctx, programPath);
  rejectUnownedCleanup(ctx, programPath);
  rejectUnownedEffects(ctx, programPath);
  ctx.header.unshift(...routeManifestStatements(ctx));

  // Safety net: any JSX left over lived outside a component function.
  rejectLeftoverJsx(ctx, programPath);

  const table = buildAccessTable(ctx);
  if (ctx.computeds.size > 0) rewriteComputeds(ctx, programPath.node);
  if (ctx.moduleControlFlow.length > 0) {
    rewriteModuleControlFlow(ctx, programPath.node);
  }
  if (table) ctx.header.push(table);

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
  const babelContainer = programPath as ProgramTransformPath & {
    unshiftContainer?(
      key: 'body',
      nodes: t.Statement | t.Statement[],
    ): unknown;
    pushContainer?(key: 'body', node: t.Statement): unknown;
  };
  if (babelContainer.unshiftContainer === undefined) {
    programPath.node.body.unshift(...imports, ...ctx.header);
  } else {
    for (let index = ctx.header.length - 1; index >= 0; index--) {
      babelContainer.unshiftContainer('body', ctx.header[index]!);
    }
    babelContainer.unshiftContainer('body', imports);
  }
  if (ctx.rootComponent !== null) {
    const registration = t.expressionStatement(
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
    );
    if (babelContainer.pushContainer === undefined) {
      programPath.node.body.push(registration);
    } else {
      babelContainer.pushContainer('body', registration);
    }
  }
}

function transformProgramAst(
  programPath: ProgramTransformPath,
  opts: InternalMemoDomOptions = {},
): void {
  const ctx = createCtx(opts);
  prepareProgram(ctx, programPath);
  for (const [name, componentPath] of ctx.compPaths) {
    transformComponent(ctx, componentPath, name);
  }
  finishProgram(ctx, programPath);
}

/** Transform a plain ESTree program and leave the result in strict ESTree. */
export function transformEstreeProgram(
  programPath: ProgramTransformPath,
  opts: InternalMemoDomOptions = {},
): void {
  transformProgramAst(programPath, opts);
  normalizeEstreeDialect(programPath.node as unknown as BaseNode);
}

export default function memoDomPlugin(
  _api: unknown,
  opts: InternalMemoDomOptions = {},
): PluginObject {
  const ctx = createCtx(opts);
  const transformed = new WeakSet<t.Node>();
  return {
    name: 'memo-dom',
    visitor: {
      Program: {
        enter(programPath) {
          prepareProgram(ctx, programPath);
        },
        exit(programPath) {
          finishProgram(ctx, programPath);
        },
      },
      FunctionDeclaration(path) {
        const name = path.node.id?.name;
        if (!name || !ctx.comps.has(name) || transformed.has(path.node)) return;
        transformed.add(path.node);
        transformComponent(ctx, path, name);
        path.skip();
      },
    },
  };
}

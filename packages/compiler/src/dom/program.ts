/** DOM backend program preparation, component lowering and module finalization.
 * Shared source collectors and plans remain under analysis/ and planning/.
 * Runtime-producing normalization is coordinated here until its remaining
 * source/publication contracts are separated.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { normalizeEstreeDialect, normalizeJsxLiterals, walkAst, type BaseNode } from '../ast';
import { createCtx, type DomContext as Ctx, type InternalMemoDomOptions } from './context';
import { freshWriteConst } from './constants';
import { emitModuleComputeds } from '../emission/computeds';
import { emitModuleControlFlow } from '../emission/control-flow';
import { type MemoDomOptions } from '../context';
import { generatedIdentifier, md, requireIdentifiers } from './identifiers';
import { planAccessReaders } from '../analysis/access-table';
import { emitAccessTable } from './access-table';
import { prepareProgramAnalysis } from './prepare';
import { liftModuleStateCells } from '../cells';
import { emitDomComponents } from './dom';
import { emittedRuntimeHelpers } from './runtime-requirements';
import { emitInitialMount } from './initial-entry';
import { planComponentListSites } from '../planning/list-sites';
import { planComponentRendering, type ModuleRenderPlan } from '../planning/component-render';
import { planComponentCallbacks } from '../planning/component-callbacks';
import { planModuleCallbacks } from '../planning/module-callbacks';
import { instrumentSharedCallback } from './handlers';
import { planExpressionSources } from '../planning/expression-sources';
import { planComponentPulls } from '../planning/primitive-pull';
import { planComponentPlacements } from '../planning/component-placement';
import { planRegionReplays } from '../planning/region-replay';
import { rejectUnownedCleanup } from './lifecycle';
import { rejectUnownedEffects, rewriteModuleEffects } from '../effects';
import { routeManifestStatements, initialRoutePreparationStatements } from './router';
import { analyzeRoutedPreparations } from '../routed';
import { rewriteTransparentDataReads } from './read-rewriting';
import { externalReactiveImportStatements } from './external-reactivity';

interface ProgramDiagnostic {
  node: t.Program;
  buildCodeFrameError(message: string, at?: t.Node): Error;
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
        leftover = astFactory.isJSXIdentifier(opening.name)
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

function prepareProgram(ctx: Ctx, programPath: ProgramTransformPath): ModuleRenderPlan {
  prepareProgramAnalysis(ctx, programPath);
  analyzeRoutedPreparations(ctx, programPath, true);
  rewriteTransparentDataReads(ctx);
  ctx.moduleCallbacks = planModuleCallbacks(ctx, programPath);
  for (const site of ctx.moduleCallbacks.retained)
    instrumentSharedCallback(ctx, site.target, site.executionAware);
  return planComponentRendering(ctx.compPaths, {
    callbacks: new Map(
      [...ctx.compPaths].map(([name, path]) => [name, planComponentCallbacks(ctx, name, path)]),
    ),
    expressionSources: planExpressionSources(ctx),
    pullPlans: planComponentPulls(ctx),
    placements: planComponentPlacements(ctx),
    regionReplays: planRegionReplays(ctx),
    listSites: planComponentListSites(ctx),
    renderCallbackProps: new Map(
      [...ctx.componentProps].map(([name, props]) => [name, [...props.renderCallbacks]]),
    ),
  });
}

function finishProgram(ctx: Ctx, programPath: ProgramTransformPath): void {
  liftModuleStateCells(ctx, programPath);
  rewriteModuleEffects(ctx, programPath);
  rejectUnownedCleanup(ctx, programPath);
  rejectUnownedEffects(ctx, programPath);
  ctx.emission.header.unshift(...routeManifestStatements(ctx));

  // Safety net: any JSX left over lived outside a component function.
  rejectLeftoverJsx(ctx, programPath);

  const table = emitAccessTable(ctx, planAccessReaders(ctx));
  if (ctx.computeds.size > 0)
    emitModuleComputeds(ctx, programPath.node, {
      fresh: (name) => generatedIdentifier(ctx, name),
      runtime: (name) => md(ctx, name),
      writes: (keys) => freshWriteConst(ctx, keys),
    });
  if (ctx.moduleControlFlow.length > 0) {
    emitModuleControlFlow(ctx, programPath.node, {
      fresh: (name) => generatedIdentifier(ctx, name),
      runtime: (name) => md(ctx, name),
      writes: (keys) => freshWriteConst(ctx, keys),
    });
  }
  if (table) ctx.emission.header.push(table);

  if (Object.keys(ctx.lazyRouteImports).length > 0) {
    programPath.node.body = programPath.node.body.filter((statement) => {
      if (!astFactory.isImportDeclaration(statement)) return true;
      statement.specifiers = statement.specifiers.filter(
        (specifier) => ctx.lazyRouteImports[specifier.local.name] === undefined,
      );
      return statement.specifiers.length > 0 || statement.importKind === 'type';
    });
  }

  const imports = [
    astFactory.importDeclaration(
      [
        astFactory.importNamespaceSpecifier(
          astFactory.identifier(requireIdentifiers(ctx).runtimeId),
        ),
      ],
      astFactory.stringLiteral(ctx.runtimePath),
    ),
  ];
  imports.push(...externalReactiveImportStatements(ctx));
  if (ctx.hot) {
    imports.push(
      astFactory.importDeclaration(
        [
          astFactory.importNamespaceSpecifier(
            astFactory.identifier(requireIdentifiers(ctx).hotRuntimeId),
          ),
        ],
        astFactory.stringLiteral(ctx.hotRuntimePath),
      ),
    );
  }
  if (ctx.usesRouter) {
    imports.push(
      astFactory.importDeclaration(
        [
          astFactory.importNamespaceSpecifier(
            astFactory.identifier(requireIdentifiers(ctx).routerId),
          ),
        ],
        astFactory.stringLiteral(ctx.routerPath),
      ),
    );
  }
  if (ctx.usesTransparentData) {
    imports.push(
      astFactory.importDeclaration(
        [
          astFactory.importNamespaceSpecifier(
            astFactory.identifier(requireIdentifiers(ctx).dataRuntimeId),
          ),
        ],
        astFactory.stringLiteral(ctx.dataRuntimePath),
      ),
    );
  }
  programPath.node.body.unshift(...imports, ...ctx.emission.header);
  if (ctx.rootComponent !== null) {
    const registration = astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'registerRootFactory'), [
        astFactory.identifier(ctx.rootComponent),
        astFactory.objectExpression([
          astFactory.objectProperty(
            astFactory.identifier('id'),
            astFactory.stringLiteral(ctx.rootId),
          ),
          ...(ctx.initialDelivery === undefined
            ? []
            : [
                astFactory.objectProperty(
                  astFactory.identifier('initialDelivery'),
                  astFactory.objectExpression([
                    astFactory.objectProperty(
                      astFactory.identifier('key'),
                      astFactory.stringLiteral(ctx.initialDelivery.key),
                    ),
                    ...(ctx.initialDelivery.html === undefined
                      ? []
                      : [
                          astFactory.objectProperty(
                            astFactory.identifier('html'),
                            astFactory.stringLiteral(ctx.initialDelivery.html),
                          ),
                        ]),
                    astFactory.objectProperty(
                      astFactory.identifier('target'),
                      astFactory.stringLiteral(ctx.initialDelivery.target),
                    ),
                    astFactory.objectProperty(
                      astFactory.identifier('browser'),
                      astFactory.stringLiteral(ctx.initialDelivery.browser),
                    ),
                  ]),
                ),
              ]),
          astFactory.objectProperty(
            astFactory.identifier('create'),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.callExpression(astFactory.identifier(ctx.rootComponent), [
                astFactory.stringLiteral(ctx.rootId),
                astFactory.nullLiteral(),
                astFactory.arrayExpression([]),
              ]),
            ),
          ),
        ]),
      ]),
    );
    programPath.node.body.push(registration);
  }
  // Eager preparations and their module-local dependencies must be initialized
  // before entry gates run. Lazy modules register during the preparation walk.
  programPath.node.body.push(...initialRoutePreparationStatements(ctx));
}

function transformProgramAst(
  programPath: ProgramTransformPath,
  opts: InternalMemoDomOptions = {},
): void {
  const ctx = createCtx(opts);
  const renderPlan = prepareProgram(ctx, programPath);
  emitDomComponents(ctx, renderPlan);
  finishProgram(ctx, programPath);
  if (opts.initialMount)
    emitInitialMount(
      programPath.node,
      opts.runtimePath ?? '@memoized-dom/runtime',
      opts.initialMount.payload,
    );
  if (opts.onRuntimeHelpers) {
    opts.onRuntimeHelpers(
      emittedRuntimeHelpers(
        programPath.node as unknown as BaseNode,
        requireIdentifiers(ctx).runtimeId,
      ),
    );
  }
}

/** Transform a plain ESTree program and leave the result in strict ESTree. */
export function transformEstreeProgram(
  programPath: ProgramTransformPath,
  opts: InternalMemoDomOptions = {},
): void {
  normalizeJsxLiterals(programPath.node as unknown as BaseNode);
  transformProgramAst(programPath, opts);
  normalizeEstreeDialect(programPath.node as unknown as BaseNode);
}

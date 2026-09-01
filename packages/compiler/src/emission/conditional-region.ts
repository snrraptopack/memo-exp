import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  exprReadsInstanceState,
  type Ctx,
} from '../context';
import { componentId, generatedIdentifier, md } from '../identifiers';
import { analyzeCondSite } from '../conds';
import type { JsxNode } from '../jsx/children';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
  type EmitScope,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import {
  subscribeTransparentStructuralSite,
  transparentExpressionSources,
} from '../data-sources';

type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

/** Emit an anchored conditional region owned by a component or row. */
export function emitConditionalRegion(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.ConditionalExpression | t.LogicalExpression,
  parentElementVariable: string,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  forwardFromOwner = false,
): void {
  const site = analyzeCondSite(
    expression,
    componentPath,
    scope.usedConds,
  );
  const regionVariable = generatedIdentifier(ctx, site.suffix).name;
  const regionId = astFactory.binaryExpression(
    '+',
    cloneEstreeNode(ownerId),
    astFactory.stringLiteral(`/${site.suffix}`),
  );
  const transparentSources = transparentExpressionSources(ctx, expression);

  const pick = astFactory.arrowFunctionExpression([], cloneEstreeNode(site.pickExpr));
  const branchFactories: t.Expression[] = site.branches.map((jsx) =>
    jsx !== null
      ? buildConditionalBranchCreate(
          ctx,
          jsx,
          componentName,
          componentPath,
          regionId,
          emitNode,
          inSvg,
          regionId,
          false,
          scope.usedConds,
          transparentSources,
        )
      : astFactory.nullLiteral(),
  );

  scope.creation.push(
    registerStmt(
      ctx,
      cloneEstreeNode(regionId),
      cloneEstreeNode(ownerId),
      astFactory.arrowFunctionExpression(
        [],
        astFactory.callExpression(
          astFactory.memberExpression(
            astFactory.identifier(regionVariable),
            astFactory.identifier('update'),
          ),
          [],
        ),
      ),
    ),
  );
  subscribeTransparentStructuralSite(
    ctx,
    scope,
    expression,
    regionId,
  );
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(regionVariable),
        astFactory.callExpression(md(ctx, 'createCondRegion'), [
          astFactory.identifier(parentElementVariable),
          cloneEstreeNode(regionId),
          pick,
          astFactory.arrayExpression(branchFactories),
        ]),
      ),
    ]),
  );
  if (
    forwardFromOwner ||
    ctx.volatileComponents.has(componentName) ||
    exprReadsInstanceState(ctx, expression, componentName)
  ) {
    scope.updaters.push(() =>
      astFactory.expressionStatement(
        astFactory.callExpression(
          astFactory.memberExpression(
            astFactory.identifier(regionVariable),
            astFactory.identifier('update'),
          ),
          [],
        ),
      ),
    );
  }
  scope.disposableRegions.push(regionVariable);
  scope.disposableEntities.push(cloneEstreeNode(regionId));
}

/** Build a non-entity branch factory with isolated slots and cleanup. */
export function buildConditionalBranchCreate(
  ctx: Ctx,
  jsx: JsxNode,
  componentName: string,
  componentPath: ComponentPath,
  regionId: t.Expression,
  emitNode: NodeEmitter,
  inSvg = false,
  ownerId: t.Expression = regionId,
  allowConditions = false,
  usedConditions?: { count: number },
  coveredTransparentSources: readonly string[] = [],
): t.ArrowFunctionExpression {
  const branchScope = newEmitScope(ctx, true);
  for (const source of coveredTransparentSources) {
    branchScope.coveredTransparentSources.add(source);
  }
  if (usedConditions !== undefined) {
    branchScope.usedConds = usedConditions;
  }
  const rootVariable = emitNode(
    ctx,
    branchScope,
    jsx,
    componentName,
    componentPath,
    allowConditions ? null : 'cond',
    undefined,
    regionId,
    inSvg,
    ownerId,
  );
  const properties: t.ObjectProperty[] = [
    astFactory.objectProperty(
      astFactory.identifier('nodes'),
      astFactory.callExpression(md(ctx, 'rootNodes'), [
        astFactory.identifier(rootVariable),
      ]),
    ),
    astFactory.objectProperty(
      astFactory.identifier('update'),
      astFactory.identifier(branchScope.updateVar),
    ),
  ];

  if (
    branchScope.disposableRegions.length > 0 ||
    branchScope.disposableEntities.length > 0 ||
    branchScope.disposableCallbacks.length > 0
  ) {
    const disposeStatements: t.Statement[] = [
      ...[...branchScope.disposableCallbacks].reverse().map((callback) =>
        astFactory.ifStatement(
          astFactory.binaryExpression(
            '!==',
            cloneEstreeNode(callback),
            astFactory.nullLiteral(),
          ),
          astFactory.expressionStatement(
            astFactory.callExpression(cloneEstreeNode(callback), []),
          ),
        ),
      ),
      ...branchScope.disposableRegions.map((region) =>
        astFactory.expressionStatement(
          astFactory.callExpression(
            astFactory.memberExpression(
              astFactory.identifier(region),
              astFactory.identifier('dispose'),
            ),
            [],
          ),
        ),
      ),
      ...branchScope.disposableEntities.map((entity) =>
        astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'unregisterSubtree'), [
            cloneEstreeNode(entity),
          ]),
        ),
      ),
    ];
    properties.push(
      astFactory.objectProperty(
        astFactory.identifier('dispose'),
        astFactory.arrowFunctionExpression(
          [],
          astFactory.blockStatement(disposeStatements),
        ),
      ),
    );
  }

  return astFactory.arrowFunctionExpression(
    [],
    astFactory.blockStatement([
      cacheDecl(branchScope),
      ...branchScope.prelude,
      updateDecl(branchScope),
      ...branchScope.creation,
      ...branchScope.mounts,
      astFactory.returnStatement(astFactory.objectExpression(properties)),
    ]),
  );
}

import * as t from '@babel/types';
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
  const regionId = t.binaryExpression(
    '+',
    t.cloneNode(ownerId),
    t.stringLiteral(`/${site.suffix}`),
  );
  const transparentSources = transparentExpressionSources(ctx, expression);

  const pick = t.arrowFunctionExpression([], t.cloneNode(site.pickExpr));
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
      : t.nullLiteral(),
  );

  scope.creation.push(
    registerStmt(
      ctx,
      t.cloneNode(regionId),
      t.cloneNode(ownerId),
      t.arrowFunctionExpression(
        [],
        t.callExpression(
          t.memberExpression(
            t.identifier(regionVariable),
            t.identifier('update'),
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
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(regionVariable),
        t.callExpression(md(ctx, 'createCondRegion'), [
          t.identifier(parentElementVariable),
          t.cloneNode(regionId),
          pick,
          t.arrayExpression(branchFactories),
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
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(regionVariable),
            t.identifier('update'),
          ),
          [],
        ),
      ),
    );
  }
  scope.disposableRegions.push(regionVariable);
  scope.disposableEntities.push(t.cloneNode(regionId));
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
    t.objectProperty(
      t.identifier('nodes'),
      t.callExpression(md(ctx, 'rootNodes'), [
        t.identifier(rootVariable),
      ]),
    ),
    t.objectProperty(
      t.identifier('update'),
      t.identifier(branchScope.updateVar),
    ),
  ];

  if (
    branchScope.disposableRegions.length > 0 ||
    branchScope.disposableEntities.length > 0 ||
    branchScope.disposableCallbacks.length > 0
  ) {
    const disposeStatements: t.Statement[] = [
      ...[...branchScope.disposableCallbacks].reverse().map((callback) =>
        t.ifStatement(
          t.binaryExpression(
            '!==',
            t.cloneNode(callback),
            t.nullLiteral(),
          ),
          t.expressionStatement(
            t.callExpression(t.cloneNode(callback), []),
          ),
        ),
      ),
      ...branchScope.disposableRegions.map((region) =>
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(region),
              t.identifier('dispose'),
            ),
            [],
          ),
        ),
      ),
      ...branchScope.disposableEntities.map((entity) =>
        t.expressionStatement(
          t.callExpression(md(ctx, 'unregisterSubtree'), [
            t.cloneNode(entity),
          ]),
        ),
      ),
    ];
    properties.push(
      t.objectProperty(
        t.identifier('dispose'),
        t.arrowFunctionExpression(
          [],
          t.blockStatement(disposeStatements),
        ),
      ),
    );
  }

  return t.arrowFunctionExpression(
    [],
    t.blockStatement([
      cacheDecl(branchScope),
      ...branchScope.prelude,
      updateDecl(branchScope),
      ...branchScope.creation,
      ...branchScope.mounts,
      t.returnStatement(t.objectExpression(properties)),
    ]),
  );
}

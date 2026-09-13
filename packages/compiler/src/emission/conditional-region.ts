import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  exprReadsInstanceState,
  type ComponentPath,
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

/** Static path appended to a component factory id by enclosing regions. */
function ownerPathSuffix(expression: t.Expression): string | null {
  if (astFactory.isIdentifier(expression)) return '';
  if (
    expression.type === 'BinaryExpression' &&
    expression.operator === '+' &&
    astFactory.isStringLiteral(expression.right)
  ) {
    const parent = ownerPathSuffix(expression.left as t.Expression);
    return parent === null ? null : `${parent}${expression.right.value}`;
  }
  return null;
}

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

  // Route regions are real runtime owners (`App/route0/...`). Conditional
  // read analysis runs before emission and starts from the component path, so
  // record the concrete route prefix once emission has assigned it. Without
  // this adjustment a module write targets `App/when0` while the live entity
  // is `App/route0/when0`, leaving the DOM stale until an unrelated broader
  // invalidation happens.
  const emittedOwnerSuffix = ownerPathSuffix(ownerId);
  if (emittedOwnerSuffix?.includes('/route') === true) {
    const read = ctx.condReads.get(`${componentName}/${site.suffix}`);
    if (read !== undefined) {
      read.suffix = `${emittedOwnerSuffix.slice(1)}/${read.suffix}`;
    }
  }

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
          scope.reasonVar !== null,
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
          scope.reasonVar === null
            ? []
            : [astFactory.identifier(scope.reasonVar)],
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
  forwardReasons = false,
): t.ArrowFunctionExpression {
  const branchScope = newEmitScope(ctx, true);
  if (forwardReasons) {
    branchScope.reasonVar = generatedIdentifier(ctx, 'reasons').name;
  }
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

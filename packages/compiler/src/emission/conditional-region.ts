import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { initialSite } from '../planning/initial-render';
import { initialNode, initialOrCreate, initialServerAnchor, initialStructuralPlacement } from './initial-dom';
import {
  type ComponentPath,
  type Ctx,
} from '../context';
import { componentId, generatedIdentifier, md } from '../identifiers';
import type { JsxNode } from '../jsx/children';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
  type EmitScope,
  type RegionSourcePlans,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import {
  preparationRead,
  subscribeTransparentStructuralSite,
  transparentExpressionSources,
  atomicSitePolicy,
  transparentBoundaryPolicyArgument,
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
  const site = { ...scope.regionShapes!.conditionalFor(expression), suffix: `when${scope.usedConds.count++}` };
  const regionVariable = generatedIdentifier(ctx, site.suffix).name;
  const regionId = astFactory.binaryExpression(
    '+',
    cloneEstreeNode(ownerId),
    astFactory.stringLiteral(`/${site.suffix}`),
  );
  const atomic = atomicSitePolicy(expression);
  if (atomic !== undefined) {
    const policy = generatedIdentifier(ctx, 'atomicPolicy');
    const cause = generatedIdentifier(ctx, 'atomicError');
    const retry = generatedIdentifier(ctx, 'atomicRetry');
    const renderer = (kind: 'pending' | 'error') => astFactory.memberExpression(
      cloneEstreeNode(policy), astFactory.identifier(kind));
    const fallback = (kind: 'pending' | 'error') => {
      const child = generatedIdentifier(ctx, 'atomicFallback');
      const childId = astFactory.binaryExpression('+', cloneEstreeNode(regionId), astFactory.stringLiteral(`/$${kind}`));
      return astFactory.conditionalExpression(renderer(kind), astFactory.arrowFunctionExpression(
        kind === 'pending' ? [] : [cloneEstreeNode(cause), cloneEstreeNode(retry)],
        astFactory.blockStatement([
          astFactory.variableDeclaration('const', [astFactory.variableDeclarator(child,
            astFactory.callExpression(renderer(kind), [cloneEstreeNode(childId), cloneEstreeNode(ownerId),
              ...(kind === 'pending' ? [] : [cloneEstreeNode(cause), cloneEstreeNode(retry)])]))]),
          astFactory.returnStatement(astFactory.objectExpression([
            astFactory.objectProperty(astFactory.identifier('nodes'), astFactory.callExpression(md(ctx, 'rootNodes'), [cloneEstreeNode(child)])),
            astFactory.objectProperty(astFactory.identifier('update'), astFactory.arrowFunctionExpression([], astFactory.blockStatement([]))),
            astFactory.objectProperty(astFactory.identifier('dispose'), astFactory.arrowFunctionExpression([],
              astFactory.callExpression(md(ctx, 'unregisterSubtree'), [cloneEstreeNode(childId)]))),
          ])),
        ])), astFactory.identifier('undefined'));
    };
    const branch = buildConditionalBranchCreate(ctx, site.branches[0]!, componentName, componentPath,
      regionId, emitNode, inSvg, regionId, true, scope.usedConds, [], true, scope);
    (branch.body as t.BlockStatement).body.unshift(registerStmt(ctx, cloneEstreeNode(regionId), cloneEstreeNode(ownerId),
      astFactory.arrowFunctionExpression([], astFactory.callExpression(astFactory.memberExpression(
        astFactory.identifier(regionVariable), astFactory.identifier('update')), []))));
    scope.creation.push(astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(cloneEstreeNode(policy), transparentBoundaryPolicyArgument(ctx, componentName, atomic)),
      astFactory.variableDeclarator(astFactory.identifier(regionVariable), astFactory.callExpression(md(ctx, 'createPreparedRegion'), [
        astFactory.identifier(parentElementVariable), cloneEstreeNode(regionId), branch, fallback('pending'), fallback('error'),
      ])),
    ]));
    scope.updaters.push(() => astFactory.expressionStatement(astFactory.callExpression(astFactory.memberExpression(
      astFactory.identifier(regionVariable), astFactory.identifier('update')), scope.reasonVar === null ? [] : [astFactory.identifier(scope.reasonVar)])));
    scope.disposableRegions.push(regionVariable);
    scope.disposableEntities.push(cloneEstreeNode(regionId));
    return;
  }
  const transparentSources = transparentExpressionSources(expression);

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

  const pick = astFactory.arrowFunctionExpression([], preparationRead(
    ctx, scope, regionId, cloneEstreeNode(site.pickExpr), transparentSources,
  ));
  const initial=scope.initialDom?.plan.conditions[initialSite(expression)];
  if (scope.initialDom && !initial) throw new Error('memo-dom: initial conditional has no placement');
  const branchFactories: t.Expression[] = site.branches.map((jsx,index) => {
    const branch=initial?.branches?.[index];
    const binding=branch ? {
      plan:branch,variable:generatedIdentifier(ctx,'initialBranchNodes').name,descriptors:[],
      adopting:generatedIdentifier(ctx,'adoptingBranch'),
    } : initial && initial.branch === index && initial.returnSite !== null ? {
      ...scope.initialDom!,plan:{...scope.initialDom!.plan,returnSite:initial.returnSite},
      adopting:generatedIdentifier(ctx,'adoptingBranch'),
    } : undefined;
    const target=branch ? astFactory.memberExpression(
      initialNode(scope,initial!.open,`#comment:mmd:initial:when:${initialSite(expression)}`),
      astFactory.identifier('nextSibling'),
    ) : undefined;
    return (
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
          scope,
          binding,
          target,
        )
      : astFactory.nullLiteral()
    );
  });

  const serverPlacement=initialStructuralPlacement(ctx.initialServerComponents[componentName],initialSite(expression))?.conditions[initialSite(expression)];
  const serverAnchor=(closing:boolean)=>initialServerAnchor(ctx,scope,parentElementVariable,'when',initialSite(expression),closing);
  if (serverPlacement) scope.creation.push(serverAnchor(false));

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
          ...(initial ? [astFactory.identifier('undefined'),initialOrCreate(scope,astFactory.objectExpression([
            astFactory.objectProperty(astFactory.identifier('open'),initialNode(scope,initial.open,`#comment:mmd:initial:when:${initialSite(expression)}`)),
            astFactory.objectProperty(astFactory.identifier('end'),initialNode(scope,initial.end,'#comment:/mmd:initial:when')),
            ...(initial.branch===null ? [] : [astFactory.objectProperty(astFactory.identifier('index'),astFactory.numericLiteral(initial.branch))]),
          ]),astFactory.identifier('undefined'))] : []),
        ]),
      ),
    ]),
  );
  if (serverPlacement) scope.creation.push(serverAnchor(true));
  if (
    forwardFromOwner ||
    scope.regionReplay!.conditionFromOwner(expression)
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
  sources: RegionSourcePlans | null = null,
  initial?: EmitScope['initialDom'],
  initialTarget?: t.Expression,
): t.ArrowFunctionExpression {
  const branchScope = newEmitScope(ctx, true, sources);
  if (initial) branchScope.initialDom=initial;
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
  if (initialTarget && initial?.adopting) branchScope.prelude.unshift(astFactory.variableDeclaration('const',[
    astFactory.variableDeclarator(astFactory.identifier(initial.variable),astFactory.conditionalExpression(
      cloneEstreeNode(initial.adopting),astFactory.callExpression(md(ctx,initial.plan.dynamicPaths?'bindInitialListNodes':'bindInitialNodes'),[
        initialTarget,astFactory.arrayExpression(initial.descriptors),
      ]),astFactory.arrayExpression([]))),
  ]));
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
    initial?.adopting ? [initial.adopting] : [],
    astFactory.blockStatement([
      cacheDecl(branchScope),
      ...branchScope.prelude,
      updateDecl(ctx, branchScope),
      ...branchScope.creation,
      ...branchScope.mounts,
      astFactory.returnStatement(astFactory.objectExpression(properties)),
    ]),
  );
}

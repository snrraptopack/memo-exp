/** Anchored DOM region controlled by one compiler-generated route match ID. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { ComponentPath } from '../context';
import type { DomContext as Ctx } from './context';
import { generatedIdentifier, md, mr } from './identifiers';
import type { CompilerRouteElement } from '../router';
import type { EmitScope } from './scope';
import { registerStmt, renderDocument } from './scope';
import type { NodeEmitter } from './node-emitter';
import { buildConditionalBranchCreate } from './conditional-region';
import { atomicRoutePolicy, atomicSite } from '../features/data-sources/atomic-sites';

export function emitRouteRegion(
  ctx: Ctx,
  scope: EmitScope,
  element: t.JSXElement,
  route: CompilerRouteElement,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg: boolean,
  ownerId: t.Expression,
): string {
  const fragment = generatedIdentifier(ctx, 'routeFragment');
  const region = generatedIdentifier(ctx, 'routeRegion');
  const unsubscribe = generatedIdentifier(ctx, 'routeUnsubscribe');
  const dispose = generatedIdentifier(ctx, 'routeDispose');
  const currentRoute = generatedIdentifier(ctx, 'currentRoute');
  const regionIndex = scope.regionCounter++;
  const regionId = astFactory.binaryExpression(
    '+',
    cloneEstreeNode(ownerId),
    astFactory.stringLiteral(`/route${regionIndex}`),
  );

  // Suppress only this route while its selected branch is emitted. Keeping the
  // original subtree is important: nested elements retain their WeakMap route
  // metadata and therefore become their own independently anchored regions.
  ctx.routeElements.delete(element);
  ctx.routeCallsiteIds.set(element, route.id);
  let branch: t.ArrowFunctionExpression;
  try {
    branch = buildConditionalBranchCreate(
      ctx,
      atomicRoutePolicy(element) === undefined ? element : atomicSite(element, atomicRoutePolicy(element)),
      componentName,
      componentPath,
      regionId,
      emitNode,
      inSvg,
      regionId,
      true,
      scope.usedConds,
      [],
      false,
      scope,
    );
  } finally {
    ctx.routeElements.set(element, route);
    ctx.routeCallsiteIds.delete(element);
  }
  const contextName = ctx.routeContextParams.get(componentName);
  const context = contextName === undefined
    ? astFactory.identifier('undefined')
    : astFactory.identifier(contextName);
  const instanceId = astFactory.conditionalExpression(
    cloneEstreeNode(context),
    astFactory.binaryExpression(
      '+',
      cloneEstreeNode(context),
      astFactory.stringLiteral(`>>${route.id}`),
    ),
    astFactory.stringLiteral(route.id),
  );
  const selected = astFactory.arrowFunctionExpression(
    [cloneEstreeNode(currentRoute)],
    astFactory.callExpression(mr(ctx, 'routeRegionIdentity'), [
      cloneEstreeNode(currentRoute), instanceId,
    ]),
  );
  const updateRegion = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(
      astFactory.memberExpression(cloneEstreeNode(region), astFactory.identifier('update')),
      [],
    ),
  );

  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(fragment),
        astFactory.callExpression(
          astFactory.memberExpression(
            renderDocument(ctx, scope),
            astFactory.identifier('createDocumentFragment'),
          ),
          [],
        ),
      ),
    ]),
    registerStmt(
      ctx,
      cloneEstreeNode(regionId),
      cloneEstreeNode(ownerId),
      cloneEstreeNode(updateRegion),
    ),
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(region),
        astFactory.callExpression(md(ctx, 'createCondRegion'), [
          cloneEstreeNode(fragment),
          cloneEstreeNode(regionId),
          astFactory.arrowFunctionExpression(
            [],
            astFactory.conditionalExpression(
              astFactory.binaryExpression('!==',
                astFactory.callExpression(selected, [mr(ctx, 'route')]), astFactory.nullLiteral()),
              astFactory.numericLiteral(0),
              astFactory.numericLiteral(1),
            ),
          ),
          astFactory.arrayExpression([branch, astFactory.nullLiteral()]),
          astFactory.arrowFunctionExpression([], astFactory.callExpression(selected, [mr(ctx, 'route')])),
        ]),
      ),
    ]),
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(unsubscribe),
        astFactory.callExpression(mr(ctx, 'subscribeRouteSelected'), [
          cloneEstreeNode(selected),
          cloneEstreeNode(updateRegion),
        ]),
      ),
    ]),
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(dispose),
        astFactory.arrowFunctionExpression(
          [],
          astFactory.blockStatement([
            astFactory.expressionStatement(
              astFactory.callExpression(cloneEstreeNode(unsubscribe), []),
            ),
            astFactory.expressionStatement(
              astFactory.callExpression(
                astFactory.memberExpression(cloneEstreeNode(region), astFactory.identifier('dispose')),
                [],
              ),
            ),
          ]),
        ),
      ),
    ]),
  );

  // The branch is a nested update scope. Component-local writes dirty the
  // component owner, so forward that owner update into the currently mounted
  // route branch just like an ordinary conditional region does. Without this,
  // local state rendered beneath `route` changes only after remounting.
  scope.updaters.push(() =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          cloneEstreeNode(region),
          astFactory.identifier('update'),
        ),
        [],
      ),
    ),
  );

  if (scope.manualDisposal) {
    scope.disposableCallbacks.push(dispose);
    scope.disposableEntities.push(cloneEstreeNode(regionId));
  } else {
    scope.creation.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'cleanup'), [
          cloneEstreeNode(ownerId),
          cloneEstreeNode(dispose),
        ]),
      ),
    );
  }
  return fragment.name;
}

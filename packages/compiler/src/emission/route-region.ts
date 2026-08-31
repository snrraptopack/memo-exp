/** Anchored DOM region controlled by one compiler-generated route match ID. */

import * as t from '@babel/types';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier, md, mr } from '../identifiers';
import type { CompilerRouteElement } from '../router';
import type { EmitScope } from './scope';
import { registerStmt, renderDocument } from './scope';
import type { NodeEmitter } from './node-emitter';
import { buildConditionalBranchCreate } from './conditional-region';

type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

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
  const match = generatedIdentifier(ctx, 'routeMatch');
  const regionIndex = scope.regionCounter++;
  const regionId = t.binaryExpression(
    '+',
    cloneEstreeNode(ownerId),
    t.stringLiteral(`/route${regionIndex}`),
  );

  // Suppress only this route while its selected branch is emitted. Keeping the
  // original subtree is important: nested elements retain their WeakMap route
  // metadata and therefore become their own independently anchored regions.
  ctx.routeElements.delete(element);
  let branch: t.ArrowFunctionExpression;
  try {
    branch = buildConditionalBranchCreate(
      ctx,
      element,
      componentName,
      componentPath,
      regionId,
      emitNode,
      inSvg,
      regionId,
      true,
      scope.usedConds,
    );
  } finally {
    ctx.routeElements.set(element, route);
  }
  const selected = t.arrowFunctionExpression(
    [cloneEstreeNode(currentRoute)],
    t.callExpression(
      t.memberExpression(
        t.memberExpression(
          cloneEstreeNode(currentRoute),
          t.identifier('matches'),
        ),
        t.identifier('some'),
      ),
      [
        t.arrowFunctionExpression(
          [cloneEstreeNode(match)],
          t.binaryExpression(
            '===',
            t.memberExpression(cloneEstreeNode(match), t.identifier('id')),
            t.stringLiteral(route.id),
          ),
        ),
      ],
    ),
  );
  const updateRegion = t.arrowFunctionExpression(
    [],
    t.callExpression(
      t.memberExpression(cloneEstreeNode(region), t.identifier('update')),
      [],
    ),
  );

  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        cloneEstreeNode(fragment),
        t.callExpression(
          t.memberExpression(
            renderDocument(ctx, scope),
            t.identifier('createDocumentFragment'),
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
    t.variableDeclaration('const', [
      t.variableDeclarator(
        cloneEstreeNode(region),
        t.callExpression(md(ctx, 'createCondRegion'), [
          cloneEstreeNode(fragment),
          cloneEstreeNode(regionId),
          t.arrowFunctionExpression(
            [],
            t.conditionalExpression(
              t.callExpression(selected, [mr(ctx, 'route')]),
              t.numericLiteral(0),
              t.numericLiteral(1),
            ),
          ),
          t.arrayExpression([branch, t.nullLiteral()]),
        ]),
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        cloneEstreeNode(unsubscribe),
        t.callExpression(mr(ctx, 'subscribeRouteSelected'), [
          cloneEstreeNode(selected),
          cloneEstreeNode(updateRegion),
        ]),
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        cloneEstreeNode(dispose),
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(cloneEstreeNode(unsubscribe), []),
            ),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(cloneEstreeNode(region), t.identifier('dispose')),
                [],
              ),
            ),
          ]),
        ),
      ),
    ]),
  );

  if (scope.manualDisposal) {
    scope.disposableCallbacks.push(dispose);
    scope.disposableEntities.push(cloneEstreeNode(regionId));
  } else {
    scope.creation.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'cleanup'), [
          cloneEstreeNode(ownerId),
          cloneEstreeNode(dispose),
        ]),
      ),
    );
  }
  return fragment.name;
}

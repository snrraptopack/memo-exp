/** Anchored DOM region controlled by one compiler-generated route match ID. */

import * as t from '@babel/types';
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
    t.cloneNode(ownerId),
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
    [t.cloneNode(currentRoute)],
    t.callExpression(
      t.memberExpression(
        t.memberExpression(
          t.cloneNode(currentRoute),
          t.identifier('matches'),
        ),
        t.identifier('some'),
      ),
      [
        t.arrowFunctionExpression(
          [t.cloneNode(match)],
          t.binaryExpression(
            '===',
            t.memberExpression(t.cloneNode(match), t.identifier('id')),
            t.stringLiteral(route.id),
          ),
        ),
      ],
    ),
  );
  const updateRegion = t.arrowFunctionExpression(
    [],
    t.callExpression(
      t.memberExpression(t.cloneNode(region), t.identifier('update')),
      [],
    ),
  );

  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(fragment),
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
      t.cloneNode(regionId),
      t.cloneNode(ownerId),
      t.cloneNode(updateRegion),
    ),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(region),
        t.callExpression(md(ctx, 'createCondRegion'), [
          t.cloneNode(fragment),
          t.cloneNode(regionId),
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
        t.cloneNode(unsubscribe),
        t.callExpression(mr(ctx, 'subscribeRouteSelected'), [
          t.cloneNode(selected),
          t.cloneNode(updateRegion),
        ]),
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(dispose),
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(t.cloneNode(unsubscribe), []),
            ),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.cloneNode(region), t.identifier('dispose')),
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
    scope.disposableEntities.push(t.cloneNode(regionId));
  } else {
    scope.creation.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'cleanup'), [
          t.cloneNode(ownerId),
          t.cloneNode(dispose),
        ]),
      ),
    );
  }
  return fragment.name;
}

/** Anchored DOM region controlled by one compiler-generated route match ID. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
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
  const regionId = astFactory.binaryExpression(
    '+',
    cloneEstreeNode(ownerId),
    astFactory.stringLiteral(`/route${regionIndex}`),
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
  const selected = astFactory.arrowFunctionExpression(
    [cloneEstreeNode(currentRoute)],
    astFactory.callExpression(
      astFactory.memberExpression(
        astFactory.memberExpression(
          cloneEstreeNode(currentRoute),
          astFactory.identifier('matches'),
        ),
        astFactory.identifier('some'),
      ),
      [
        astFactory.arrowFunctionExpression(
          [cloneEstreeNode(match)],
          astFactory.binaryExpression(
            '===',
            astFactory.memberExpression(cloneEstreeNode(match), astFactory.identifier('id')),
            astFactory.stringLiteral(route.id),
          ),
        ),
      ],
    ),
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
              astFactory.callExpression(selected, [mr(ctx, 'route')]),
              astFactory.numericLiteral(0),
              astFactory.numericLiteral(1),
            ),
          ),
          astFactory.arrayExpression([branch, astFactory.nullLiteral()]),
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

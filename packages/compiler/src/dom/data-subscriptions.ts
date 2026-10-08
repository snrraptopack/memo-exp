/** Transparent source dependency metadata and emitted subscriptions. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
} from '../ast/index';
import type { DomContext as Ctx } from './context';
import { generatedIdentifier, md, mdd } from './identifiers';
import { registerStmt, type EmitScope } from './scope';
import {transparentExpressionSources} from '../planning/async-reads';

export function sourceArray(names: readonly string[]): t.ArrayExpression {
  return astFactory.arrayExpression(
    names.map((name) => astFactory.identifier(name)),
  );
}

/** Give initial and incremental sink evaluations the same readiness claim. */
export function preparationRead(
  ctx: Ctx,
  scope: EmitScope,
  owner: t.Expression,
  expression: t.Expression,
  sources: readonly string[] = transparentExpressionSources(expression),
): t.Expression {
  if (sources.length === 0) return expression;
  const site = generatedIdentifier(ctx, 'readSite').name;
  if (scope.manualDisposal) {
    const disposer = astFactory.identifier(site);
    scope.creation.push(astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(disposer, astFactory.arrowFunctionExpression([],
        astFactory.callExpression(md(ctx, 'releasePreparationRead'), [
          cloneNode(owner, true), astFactory.stringLiteral(site),
        ]))),
    ]));
    scope.disposableCallbacks.push(disposer);
  }
  return astFactory.callExpression(md(ctx, 'readPreparationScope'), [
    cloneNode(owner, true),
    astFactory.stringLiteral(site),
    astFactory.arrowFunctionExpression([], expression),
  ]);
}


/** Authored control flow whose payload sinks self-gate per render site. */
export type RenderGatedExpression = t.Expression & {__memoDomRenderGated?: true};

function routedSourceName(ctx: Ctx, source: string): string {
  for (const [name, key] of ctx.transparentModuleSources) {
    if (key === source) return name;
  }
  return source;
}

function subscribeTransparentEntity(
  ctx: Ctx,
  scope: EmitScope,
  sources: readonly string[],
  entityId: t.Expression,
): void {
  const routed = sources.filter(
    source => !scope.coveredTransparentSources.has(source),
  );
  if (routed.length === 0) return;
  const bindingNames = routed.map((source) => routedSourceName(ctx, source));
  scope.mounts.push(
    astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'cleanup'), [
        cloneNode(entityId, true),
        astFactory.callExpression(mdd(ctx, 'connectResolvedValues'), [
          sourceArray(bindingNames),
          astFactory.arrowFunctionExpression(
            [],
            astFactory.callExpression(md(ctx, 'invalidateEntity'), [
              cloneNode(entityId, true),
            ]),
          ),
        ]),
      ]),
    ),
  );
}

/** Register one exact scalar/prop sink under its smallest structural owner. */
export function registerTransparentDataSite(
  ctx: Ctx,
  scope: EmitScope,
  sources: readonly string[],
  ownerId: t.Expression,
  render: t.Statement,
): boolean {
  const routed = sources.filter(
    source => !scope.coveredTransparentSources.has(source),
  );
  if (routed.length === 0) return false;
  const suffix = `/$data/${scope.dataSiteCounter.count++}`;
  const siteId = astFactory.binaryExpression(
    '+',
    cloneNode(ownerId, true),
    astFactory.stringLiteral(suffix),
  );
  scope.creation.push(
    registerStmt(
      ctx,
      cloneNode(siteId, true),
      cloneNode(ownerId, true),
      astFactory.arrowFunctionExpression([], astFactory.blockStatement([render])),
    ),
  );
  subscribeTransparentEntity(ctx, scope, routed, siteId);
  scope.disposableEntities.push(cloneNode(siteId, true));
  return true;
}

/** Route a transparent expression to an existing structural entity. */
export function subscribeTransparentStructuralSite(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.Expression,
  entityId: t.Expression,
): void {
  subscribeTransparentEntity(
    ctx,
    scope,
    transparentExpressionSources(expression),
    entityId,
  );
}

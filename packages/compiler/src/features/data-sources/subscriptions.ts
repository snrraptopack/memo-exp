/** Transparent source dependency metadata and emitted subscriptions. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  ESTREE_VISITOR_KEYS,
  cloneNode,
  walkAst,
  type BaseNode,
} from '../../ast';
import type { Ctx } from '../../context';
import { md, mdd } from '../../identifiers';
import { registerStmt, type EmitScope } from '../../emission/scope';

export function sourceArray(names: readonly string[]): t.ArrayExpression {
  return astFactory.arrayExpression(
    names.map((name) => astFactory.identifier(name)),
  );
}

type TransparentDataExpression = t.Expression & {
  __memoDomTransparentSources?: readonly string[];
  __memoDomTransparentSubscriptionExclusions?: readonly string[];
};

/** Authored control flow whose payload sinks self-gate per render site. */
export type RenderGatedExpression = t.Expression & {
  __memoDomRenderGated?: true;
};

export function annotateTransparentSources(
  expression: t.Expression,
  sources: readonly string[],
): void {
  const current = (expression as TransparentDataExpression)
    .__memoDomTransparentSources ?? [];
  (expression as TransparentDataExpression).__memoDomTransparentSources = [
    ...new Set([...current, ...sources]),
  ].sort();
}

export function excludeTransparentSubscriptions(
  expression: t.Expression,
  sources: readonly string[],
): void {
  if (sources.length === 0) return;
  walkAst(expression as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isExpression(node as unknown as t.Node)) return;
      const target = node as unknown as TransparentDataExpression;
      const current = target.__memoDomTransparentSubscriptionExclusions ?? [];
      target.__memoDomTransparentSubscriptionExclusions = [
        ...new Set([...current, ...sources]),
      ].sort();
    },
  });
}

/** Base source bindings whose transition must update an emitted expression. */
export function transparentExpressionSources(
  ctx: Ctx,
  expression: t.Expression,
): readonly string[] {
  const found = new Set(
    (expression as TransparentDataExpression).__memoDomTransparentSources ?? [],
  );
  const visit = (node: t.Node): void => {
    if (
      astFactory.isCallExpression(node) &&
      astFactory.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      astFactory.isIdentifier(node.callee.object, {
        name: ctx.identifiers?.dataRuntimeId,
      }) &&
      astFactory.isIdentifier(node.callee.property)
    ) {
      const helper = node.callee.property.name;
      if (
        (helper === 'readResolvedValue' ||
          helper === 'readResolvedValueForRender') &&
        astFactory.isIdentifier(node.arguments[0])
      ) {
        found.add(node.arguments[0].name);
      }
      if (
        (helper === 'readModuleSourceList' ||
          helper === 'readResolvedValueForRender') &&
        astFactory.isCallExpression(node.arguments[0]) &&
        astFactory.isMemberExpression(node.arguments[0].callee) &&
        astFactory.isIdentifier(node.arguments[0].callee.property, {
          name: 'sourceRef',
        }) &&
        astFactory.isStringLiteral(node.arguments[0].arguments[0])
      ) {
        found.add(node.arguments[0].arguments[0].value);
      }
      if (
        (helper === 'readResolvedValuesForRender' ||
          helper === 'deriveResolvedValues') &&
        astFactory.isArrayExpression(node.arguments[0])
      ) {
        for (const element of node.arguments[0].elements) {
          if (astFactory.isIdentifier(element)) {
            found.add(element.name);
            continue;
          }
          if (
            astFactory.isCallExpression(element) &&
            astFactory.isMemberExpression(element.callee) &&
            astFactory.isIdentifier(element.callee.property, {
              name: 'sourceRef',
            }) &&
            astFactory.isStringLiteral(element.arguments[0])
          ) {
            found.add(element.arguments[0].value);
          }
        }
      }
    }
    for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === 'object' && 'type' in entry) {
            visit(entry as t.Node);
          }
        }
      } else if (
        child !== null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        visit(child as t.Node);
      }
    }
  };
  visit(expression);
  const excluded = new Set(
    (expression as TransparentDataExpression)
      .__memoDomTransparentSubscriptionExclusions ?? [],
  );
  return [...found].filter(source => !excluded.has(source)).sort();
}

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
            astFactory.callExpression(md(ctx, 'markDirty'), [
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
    transparentExpressionSources(ctx, expression),
    entityId,
  );
}

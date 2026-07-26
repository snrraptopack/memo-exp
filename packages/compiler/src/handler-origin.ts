/**
 * handler-origin.ts - event-origin invalidation lowering.
 *
 * Produces the nearest entity refresh for write-free event handlers and wraps
 * shared module handlers when their declaration cannot close over a site ID.
 */

import * as t from '@babel/types';
import type { Ctx, RowCtx } from './context';
import {
  componentId,
  generatedIdentifier,
  md,
} from './identifiers';

/** The nearest update unit from which an event-triggered render starts. */
export function buildEventOriginCommit(
  ctx: Ctx,
  compName: string | null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
): t.Statement {
  if (eventOriginId === undefined && rowCtx?.refreshVar !== undefined) {
    return t.expressionStatement(
      t.callExpression(t.identifier(rowCtx.refreshVar), []),
    );
  }
  const id =
    eventOriginId ??
    (rowCtx !== undefined
      ? t.identifier(rowCtx.rowIdVar)
      : compName !== null
        ? componentId(ctx, compName)
        : t.stringLiteral(ctx.rootId));
  return t.expressionStatement(
    t.callExpression(md(ctx, 'markDirty'), [t.cloneNode(id)]),
  );
}

/** A shared module handler needs a closure over its call site's entity ID. */
export function wrapSharedHandlerWithOrigin(
  ctx: Ctx,
  handler: t.Identifier,
  originCommit: t.Statement,
): t.ArrowFunctionExpression {
  const event = generatedIdentifier(ctx, 'event');
  const result = generatedIdentifier(ctx, 'returnValue');
  return t.arrowFunctionExpression(
    [event],
    t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          result,
          t.callExpression(t.cloneNode(handler), [t.cloneNode(event)]),
        ),
      ]),
      originCommit,
      t.returnStatement(t.cloneNode(result)),
    ]),
  );
}

/**
 * handler-origin.ts - event-origin invalidation lowering.
 *
 * Produces the nearest entity refresh for write-free event handlers and wraps
 * shared module handlers when their declaration cannot close over a site ID.
 */

import type * as t from '@babel/types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
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
    return astFactory.expressionStatement(
      astFactory.callExpression(astFactory.identifier(rowCtx.refreshVar), []),
    );
  }
  const id =
    eventOriginId ??
    (rowCtx !== undefined
      ? astFactory.identifier(rowCtx.rowIdVar)
      : compName !== null
        ? componentId(ctx, compName)
        : astFactory.stringLiteral(ctx.rootId));
  return astFactory.expressionStatement(
    astFactory.callExpression(md(ctx, 'markDirty'), [cloneEstreeNode(id)]),
  );
}

/** A shared module handler needs a closure over its call site's entity ID. */
export function wrapSharedHandlerWithOrigin(
  ctx: Ctx,
  handler: t.Expression,
  originCommit: t.Statement,
): t.ArrowFunctionExpression {
  const event = generatedIdentifier(ctx, 'event');
  const result = generatedIdentifier(ctx, 'returnValue');
  return astFactory.arrowFunctionExpression(
    [event],
    astFactory.blockStatement([
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          result,
          astFactory.callExpression(cloneEstreeNode(handler), [cloneEstreeNode(event)]),
        ),
      ]),
      originCommit,
      astFactory.returnStatement(cloneEstreeNode(result)),
    ]),
  );
}

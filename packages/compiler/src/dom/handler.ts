/** Lower captured writes only after callback analysis has completed. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';
import type { DomContext as Ctx } from './context';
import type { RowCtx } from './row-context';
import type { HandlerWritePlan } from '../handlers/plan';
import { finalizeHandlerInstrumentation } from './handler-execution';
import { applyListOperations } from './list-update';
import { mutationJournalVariable } from './list-bindings';

export function emitHandlerWrites(ctx: Ctx, plan: HandlerWritePlan, target: {
  row?:RowCtx; eventOriginId?:t.Expression;
  journals?:ReadonlyMap<string,string>;
} = {}): void {
  if (plan.row !== undefined && target.row === undefined) {
    throw new Error('memo-dom: missing row target for handler lowering');
  }
  applyListOperations(ctx, plan.listWrites);
  for (const site of plan.mutationSites) {
    const variable = target.journals === undefined
      ? (plan.owner === null ? undefined : mutationJournalVariable(ctx,plan.owner,site.source))
      : target.journals.get(site.source);
    if (variable === undefined) throw new Error(`memo-dom: missing mutation journal for '${site.source}'`);
    const original=cloneNode(site.path.node as t.Expression, true);
    site.path.replaceWith(astFactory.sequenceExpression([
      astFactory.callExpression(astFactory.memberExpression(astFactory.identifier(variable),astFactory.identifier('add')),[cloneNode(site.key)]),
      original,
    ]));
  }
  finalizeHandlerInstrumentation(ctx, plan.original, plan.copy, plan.copy,
    plan.scopes, plan.executionSites, plan.owner, target.row, plan.eventBoundary,
    target.eventOriginId, plan.executionAwareRoot);
}

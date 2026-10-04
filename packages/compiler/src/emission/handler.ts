/** Lower captured writes only after callback analysis has completed. */
import type { Ctx } from '../context';
import type { HandlerWritePlan } from '../handlers/plan';
import { finalizeHandlerInstrumentation } from '../handlers/execution-sites';
import { applyListOperations } from './list-update';

export function emitHandlerWrites(ctx: Ctx, plan: HandlerWritePlan): void {
  applyListOperations(ctx, plan.listWrites);
  finalizeHandlerInstrumentation(ctx, plan.original, plan.copy, plan.copy,
    plan.scopes, plan.executionSites, plan.owner, plan.row, plan.eventBoundary,
    plan.eventOriginId, plan.executionAwareRoot);
}

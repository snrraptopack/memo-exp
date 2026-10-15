/** Bind shared write/completion emission to native semantic owner identities. */
import type { HandlerWritePlan } from '../handlers/plan';
import type { HandlerRowTarget, PublicationEmissionContext } from '../emission/publication-context';
import { finalizeHandlerInstrumentation } from '../emission/handler-execution';
import type * as t from '../ast/compiler-types';
import type { ModuleCallbacks } from '../planning/module-callbacks';

export interface NativePublicationContext extends PublicationEmissionContext {
  readonly analyzedFunctions: WeakSet<t.Node>;
  moduleCallbacks: ModuleCallbacks | null;
}

export function emitNativePublication(
  ctx: NativePublicationContext,
  plan: HandlerWritePlan,
  fail: (message: string, at: t.Node) => never,
  row?: HandlerRowTarget,
  eventOrigin?: t.Expression,
): void {
  if (ctx.analyzedFunctions.has(plan.original)) return;

  for (const [scope, writes] of plan.scopes) {
    if (writes.transparentWrites.size > 0) {
      fail('External source mutations require shared source publication', plan.original);
    }

    if (scope !== plan.copy) {
      fail('Retained event callbacks require shared execution-scope emission', plan.original);
    }
  }

  ctx.analyzedFunctions.add(plan.original);

  // Native lists use their accepted range controller. DOM-specific operation
  // provenance and mutation journals stay in the browser lowering adapter.
  finalizeHandlerInstrumentation(
    ctx,
    plan.original,
    plan.copy,
    plan.copy,
    plan.scopes,
    plan.executionSites,
    plan.owner,
    row,
    plan.eventBoundary,
    eventOrigin,
    plan.executionAwareRoot,
  );
}

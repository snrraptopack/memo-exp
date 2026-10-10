/** Desktop destinations reuse core callback effects and completion semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';
import type { HandlerWritePlan } from '../handlers/plan';
import { appendScopeCommit } from '../handlers/completion';
import { compilerError } from '../errors';
import { valueExpression } from './lower-scene';

/** Local state remains owned by its scene closure; shared writes use the kernel. */
export function routeDesktopModuleWrites(
  ctx: Ctx,
  plan: HandlerWritePlan,
  core: t.Identifier,
  fresh: (name: string) => t.Identifier,
): boolean {
  let used = false;
  for (const [fn, scope] of plan.scopes) {
    const keys = new Set([
      ...scope.writes,
      ...scope.listItemWrites.keys(),
    ]);
    if (!scope.rootFallback && keys.size === 0) continue;
    const callback = fn as HandlerWritePlan['copy'];
    // Normal completion is sufficient for synchronous callbacks. Await/yield
    // need write routing at each continuation before they can share this path.
    if (callback.async || callback.generator) {
      throw compilerError(
        'memo-dom desktop: asynchronous or generator module writes require continuation instrumentation',
        ctx.moduleId,
        fn,
      );
    }

    // Proven sources select readers through the core resolver. Unbounded
    // effects invalidate the application subtree rather than guessing a key.
    const invocation = scope.rootFallback
      ? b.callExpression(
          b.memberExpression(core, b.identifier('markDirtySubtree')),
          [b.stringLiteral('Desktop')],
        )
      : b.callExpression(
          b.memberExpression(core, b.identifier('commitWrites')),
          [valueExpression([...keys].map(key => canonicalStateKey(ctx, key)).sort())],
        );
    const statement = b.expressionStatement(invocation);
    appendScopeCommit(callback, statement, fresh);
    used = true;
  }
  if (used) plan.original.body = plan.copy.body;
  return used;
}

/** Desktop destinations reuse core callback effects and completion semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';
import type { HandlerWritePlan } from '../handlers/plan';
import { appendScopeCommit } from '../handlers/completion';
import { compilerError } from '../errors';
import { valueExpression } from './value';
import { instrumentContinuations } from '../handlers/continuations';
import { emitGuardedPublication } from '../handlers/publication';
import type { ScopeWrites } from '../handlers/write-facts';

/** Local state remains owned by its scene closure; shared writes use the kernel. */
export function routeDesktopModuleWrites(
  ctx: Ctx,
  plan: HandlerWritePlan,
  core: t.Identifier,
  fresh: (name: string) => t.Identifier,
  local?: t.Identifier,
): boolean {
  let used = false;
  const publication = (scope: ScopeWrites): t.Statement | null => {
    const keys = new Set([...scope.writes, ...scope.listItemWrites.keys()]);
    const localKeys = [...scope.instanceWrites].map((key) => key.split('.')[0]!);
    if (!scope.rootFallback && keys.size === 0 && (!local || !localKeys.length)) return null;

    // Proven sources select readers through the core resolver. Unbounded
    // effects invalidate the application subtree rather than guessing a key.
    const invocation = scope.rootFallback
      ? b.callExpression(b.memberExpression(core, b.identifier('markDirtySubtree')), [
          b.stringLiteral('Desktop'),
        ])
      : b.callExpression(b.memberExpression(core, b.identifier('commitWrites')), [
          valueExpression([...keys].map((key) => canonicalStateKey(ctx, key)).sort()),
        ]);
    const statements: t.Statement[] = [];
    if (scope.rootFallback || keys.size) statements.push(b.expressionStatement(invocation));
    if (local && (localKeys.length || scope.rootFallback))
      statements.push(
        b.expressionStatement(
          b.callExpression(local, [
            valueExpression(scope.rootFallback ? null : [...new Set(localKeys)]),
          ]),
        ),
      );
    return b.blockStatement(statements);
  };
  // Completion guards, nested-site rewriting and declarations are shared.
  // The scene ABI supplies publication and await-segment continuation hooks.
  used = emitGuardedPublication(
    ctx,
    { ...plan, root: plan.copy },
    {
      commitFor: publication,
      fresh,
      runtime: (name) => b.memberExpression(core, b.identifier(name)),
      flagName: '__desktopDidWrite',
      siteOrder: 'source',
      resetFlags: true,
      append(callback, statement) {
        if (callback.generator) {
          throw compilerError(
            'memo-dom desktop: generator writes require iterator lifecycle instrumentation',
            ctx.moduleId,
            callback,
          );
        }
        if (callback.async) {
          instrumentContinuations(
            callback,
            statement,
            b.memberExpression(core, b.identifier('resumeContinuation')),
          );
        } else {
          appendScopeCommit(callback, statement, fresh);
        }
      },
    },
  );
  if (used) plan.original.body = plan.copy.body;
  return used;
}

/** Desktop destinations reuse core callback effects and completion semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';
import type { HandlerWritePlan } from '../handlers/plan';
import { appendScopeCommit } from '../handlers/completion';
import { compilerError } from '../errors';
import { valueExpression } from './lower-scene';
import { instrumentContinuations } from '../handlers/continuations';
import { markExecutionSite } from '../handlers/execution-sites';
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
  // Effects can write their own inputs. Publish only sites that executed, and
  // suppress unchanged plain assignments using the core's comparison policy.
  const guarded: t.Statement[] = [];
  const declarations: t.VariableDeclarator[] = [];
  if (plan.executionAwareRoot) {
    const sites = [...plan.executionSites.values()]
      .map((site) => ({
        ...site,
        commit: publication(site.writes),
        flag: fresh('__desktopDidWrite'),
      }))
      .filter((site) => site.commit !== null);
    const depth = (path: (typeof sites)[number]['path']): number => {
      let count = 0;
      for (let parent = path.parentPath; parent; parent = parent.parentPath) count++;
      return count;
    };
    for (const site of [...sites].sort((a, b) => depth(b.path) - depth(a.path))) {
      const temporaries = markExecutionSite(ctx, plan.original, site.path, site.flag, {
        fresh,
        runtime: (name) => b.memberExpression(core, b.identifier(name)),
      });
      declarations.push(
        b.variableDeclarator(site.flag, b.booleanLiteral(false)),
        ...temporaries.map((temporary) => b.variableDeclarator(temporary)),
      );
    }
    for (const site of sites)
      guarded.push(
        b.ifStatement(
          site.flag,
          b.blockStatement([
            site.commit!,
            // Each await closes one segment; later segments start with clean flags.
            b.expressionStatement(b.assignmentExpression('=', site.flag, b.booleanLiteral(false))),
          ]),
        ),
      );
  }
  for (const [fn, scope] of plan.scopes) {
    const statement =
      plan.executionAwareRoot && fn === plan.copy && guarded.length
        ? b.blockStatement(guarded)
        : publication(scope);
    if (!statement) continue;
    const callback = fn as HandlerWritePlan['copy'];
    if (callback.generator)
      throw compilerError(
        'memo-dom desktop: generator writes require iterator lifecycle instrumentation',
        ctx.moduleId,
        fn,
      );
    if (callback.async)
      instrumentContinuations(
        callback,
        statement,
        b.memberExpression(core, b.identifier('resumeContinuation')),
      );
    else appendScopeCommit(callback, statement, fresh);
    used = true;
  }
  if (declarations.length && b.isBlockStatement(plan.copy.body)) {
    plan.copy.body.body.unshift(b.variableDeclaration('let', declarations));
  }
  if (used) plan.original.body = plan.copy.body;
  return used;
}

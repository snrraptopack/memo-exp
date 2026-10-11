import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { type DomContext as Ctx } from './context';
import type { RowCtx } from './row-context';
import { appendScopeCommit, buildScopeCommit } from './handler-commits';
import { createScopeWrites, type ScopeWrites } from '../handlers/write-facts';
import { buildEventOriginCommit } from './handler-origin';
import { generatedIdentifier, md } from './identifiers';
import { emitGuardedPublication, isSchedulingRefresh } from '../handlers/publication';
import { isPlainDataAssignment } from '../handlers/member-assignment';
import type { HandlerExecutionSite } from '../handlers/plan';

export function finalizeHandlerInstrumentation(
  ctx: Ctx,
  rootFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  clonedFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  root: t.Node,
  scopes: Map<t.Node, ScopeWrites>,
  executionSites: ReadonlyMap<t.Node, HandlerExecutionSite>,
  compName: string | null,
  rowCtx: RowCtx | undefined,
  eventBoundary: boolean,
  eventOriginId: t.Expression | undefined,
  executionAwareRoot: boolean,
): void {
  ctx.handlerHasRootCommit.set(rootFn, scopes.has(root));
  let eventOriginCommit: t.Statement | undefined;

  if (eventBoundary && !scopes.has(root)) {
    const eventScope = createScopeWrites();
    eventScope.eventFallback = true;
    eventOriginCommit = buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId);
    scopes.set(root, eventScope);
  }

  emitGuardedPublication(
    ctx,
    {
      original: rootFn,
      copy: clonedFn,
      root,
      scopes,
      executionSites,
      executionAwareRoot,
    },
    {
      commitFor: (writes) => buildScopeCommit(ctx, writes, compName, rowCtx, eventOriginCommit),
      prepareSite(site) {
        // All authored writes finish before these guarded commits. An earlier
        // safe site must not skip content already changed by a later site.
        const aggregate = scopes.get(root);
        for (const source of site.writes.instanceStructuralWrites) {
          if (aggregate?.rootFallback || aggregate?.instanceContentWrites.has(source)) {
            site.writes.instanceContentWrites.add(source);
          }
        }
        if (
          site.path.isAssignmentExpression() &&
          astFactory.isMemberExpression(site.path.node.left) &&
          site.writes.instanceStructuralWrites.size === 0 &&
          !isPlainDataAssignment(ctx, rootFn, site.path.node.left, site.path.scope)
        ) {
          // A setter/proxy can mutate state beyond the apparent receiver.
          site.writes.rootFallback = true;
        }
      },
      fresh: (name) => generatedIdentifier(ctx, name),
      runtime: (name) => md(ctx, name),
      flagName: 'didWrite',
      siteOrder: 'depth',
      mergeKey: (writes, commit) => (isSchedulingRefresh(writes) ? JSON.stringify(commit) : null),
      append: (callback, commit) => appendScopeCommit(ctx, callback, commit),
    },
  );

  rootFn.body = clonedFn.body;
  ctx.callbackPublications.add(rootFn);
}

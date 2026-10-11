import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type DomContext as Ctx } from './context';
import type { RowCtx } from './row-context';
import { appendScopeCommit, buildScopeCommit } from './handler-commits';
import { createScopeWrites, type ScopeWrites } from '../handlers/write-facts';
import { buildEventOriginCommit } from './handler-origin';
import { generatedIdentifier, md } from './identifiers';
import { HandlerPath } from '../handlers/traversal';
import { markExecutionSite } from '../handlers/execution-sites';
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

  const guardedRootSites: Array<
    HandlerExecutionSite & {
      commit: t.Statement;
      flag?: t.Identifier;
      temporaries?: t.Identifier[];
    }
  > = [];
  if (executionAwareRoot) {
    for (const site of executionSites.values()) {
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
      const commit = buildScopeCommit(ctx, site.writes, compName, rowCtx, eventOriginCommit);
      if (commit !== null) guardedRootSites.push({ ...site, commit });
    }
  }
  for (const site of guardedRootSites) {
    site.flag = generatedIdentifier(ctx, 'didWrite');
  }
  guardedRootSites
    .sort((left, right) => pathDepth(right.path) - pathDepth(left.path))
    .forEach((site) => {
      site.temporaries = markExecutionSite(ctx, rootFn, site.path, site.flag!, {
        fresh: (name) => generatedIdentifier(ctx, name),
        runtime: (name) => md(ctx, name),
      });
    });

  // Several completed writes can request the same owner or subtree refresh.
  // With a synchronous scheduler, emitting it per site renders the final state
  // repeatedly. Merge adjacent identical scheduling commits. Other commits
  // remain ordering barriers: notifications or row-local work can have
  // observable effects.
  const guardedCommits: t.Statement[] = [];
  let pendingRootRefresh: t.IfStatement | null = null;
  let pendingRefreshKey: string | null = null;
  for (const site of guardedRootSites) {
    const writes = site.writes;
    const mergeableRefresh =
      (writes.rootFallback ||
        (writes.instanceLocal && writes.writes.size === 0 && writes.listItemWrites.size === 0)) &&
      writes.transparentWrites.size === 0 &&
      !writes.eventFallback &&
      !writes.rowLocal &&
      !writes.rowOwnerLocal;
    const refreshKey = mergeableRefresh ? JSON.stringify(site.commit) : null;
    if (refreshKey !== null && refreshKey === pendingRefreshKey && pendingRootRefresh !== null) {
      pendingRootRefresh.test = astFactory.logicalExpression(
        '||',
        pendingRootRefresh.test,
        cloneEstreeNode(site.flag!),
      );
      continue;
    }
    const guarded = astFactory.ifStatement(
      cloneEstreeNode(site.flag!),
      cloneEstreeNode(site.commit),
    );
    guardedCommits.push(guarded);
    pendingRootRefresh = mergeableRefresh ? guarded : null;
    pendingRefreshKey = refreshKey;
  }

  for (const [fn, writes] of scopes) {
    const commit =
      executionAwareRoot && fn === root
        ? guardedRootSites.length === 0
          ? buildScopeCommit(ctx, writes, compName, rowCtx, eventOriginCommit)
          : astFactory.blockStatement(guardedCommits)
        : buildScopeCommit(ctx, writes, compName, rowCtx, eventOriginCommit);
    if (commit === null) continue;
    appendScopeCommit(
      ctx,
      fn as t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
      commit,
    );
  }

  if (guardedRootSites.length > 0) {
    if (!astFactory.isBlockStatement(clonedFn.body)) {
      throw new Error('memo-dom: execution-aware callback commit did not produce a block body');
    }
    clonedFn.body.body.unshift(
      astFactory.variableDeclaration(
        'let',
        guardedRootSites.flatMap((site) => [
          astFactory.variableDeclarator(
            cloneEstreeNode(site.flag!),
            astFactory.booleanLiteral(false),
          ),
          ...(site.temporaries ?? []).map((temporary) =>
            astFactory.variableDeclarator(cloneEstreeNode(temporary)),
          ),
        ]),
      ),
    );
  }
  rootFn.body = clonedFn.body;
  ctx.callbackPublications.add(rootFn);
}

function pathDepth(path: HandlerPath): number {
  let depth = 0;
  let current: HandlerPath | null = path;
  while (current.parentPath !== null) {
    depth++;
    current = current.parentPath;
  }
  return depth;
}

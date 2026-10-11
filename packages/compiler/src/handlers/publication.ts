/** Guarded write publication shared by target callback emitters. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { cloneNode } from '../ast';
import type { Ctx } from '../context';
import type { HandlerExecutionSite, HandlerWritePlan } from './plan';
import type { ScopeWrites } from './write-facts';
import type { HandlerPath } from './traversal';
import { markExecutionSite } from './execution-sites';

interface PublicationPlan {
  original: HandlerWritePlan['original'];
  copy: HandlerWritePlan['copy'];
  root: t.Node;
  scopes: ReadonlyMap<t.Node, ScopeWrites>;
  executionSites: ReadonlyMap<t.Node, HandlerExecutionSite>;
  executionAwareRoot: boolean;
}

export interface PublicationEmitter {
  commitFor(writes: ScopeWrites): t.Statement | null;
  prepareSite?(site: HandlerExecutionSite): void;
  fresh(name: string): t.Identifier;
  runtime(name: string): t.Expression;
  flagName: string;
  /** DOM keeps its established nesting order; scenes preserve authored site order. */
  siteOrder: 'depth' | 'source';
  /** Await segments reset flags after publishing the preceding segment. */
  resetFlags?: boolean;
  mergeKey?(writes: ScopeWrites, commit: t.Statement): string | null;
  append(callback: HandlerWritePlan['copy'], commit: t.Statement): void;
}

function pathDepth(path: HandlerPath): number {
  let depth = 0;
  for (let parent = path.parentPath; parent; parent = parent.parentPath) depth++;
  return depth;
}

/** Only scheduling-only refreshes may merge across adjacent completed writes. */
export function isSchedulingRefresh(writes: ScopeWrites): boolean {
  return (
    (writes.rootFallback ||
      (writes.instanceLocal && writes.writes.size === 0 && writes.listItemWrites.size === 0)) &&
    writes.transparentWrites.size === 0 &&
    !writes.eventFallback &&
    !writes.rowLocal &&
    !writes.rowOwnerLocal
  );
}

/**
 * Allocate all flags before rewriting nested sites. Commit construction and
 * completion policy stay with the target, including its async boundary rules.
 */
export function emitGuardedPublication(
  ctx: Ctx,
  plan: PublicationPlan,
  emitter: PublicationEmitter,
): boolean {
  type PublicationSite = HandlerExecutionSite & {
    commit: t.Statement;
    flag: t.Identifier;
    temporaries: t.Identifier[];
  };
  const planned: Array<HandlerExecutionSite & { commit: t.Statement }> = [];
  if (plan.executionAwareRoot) {
    for (const site of plan.executionSites.values()) {
      emitter.prepareSite?.(site);
      const commit = emitter.commitFor(site.writes);
      if (commit) planned.push({ ...site, commit });
    }
  }
  const sites: PublicationSite[] = planned.map((site) => ({
    ...site,
    flag: emitter.fresh(emitter.flagName),
    temporaries: [],
  }));
  const deepestFirst = [...sites].sort((a, z) => pathDepth(z.path) - pathDepth(a.path));
  for (const site of deepestFirst) {
    site.temporaries = markExecutionSite(ctx, plan.original, site.path, site.flag, emitter);
  }

  const commits: t.Statement[] = [];
  let pending: t.IfStatement | null = null;
  let pendingKey: string | null = null;
  for (const site of emitter.siteOrder === 'depth' ? deepestFirst : sites) {
    const key = emitter.mergeKey?.(site.writes, site.commit) ?? null;
    if (key !== null && key === pendingKey && pending !== null) {
      pending.test = b.logicalExpression('||', pending.test, cloneNode(site.flag));
      continue;
    }
    const commit = emitter.resetFlags
      ? b.blockStatement([
          cloneNode(site.commit),
          b.expressionStatement(
            b.assignmentExpression('=', cloneNode(site.flag), b.booleanLiteral(false)),
          ),
        ])
      : cloneNode(site.commit);
    const guarded = b.ifStatement(cloneNode(site.flag), commit);
    commits.push(guarded);
    // Resetting a merged group would leave the other flags set across awaits.
    // Until that group has a reset for each site, it remains a merge barrier.
    pending = emitter.resetFlags ? null : guarded;
    pendingKey = key;
  }

  let published = false;
  for (const [fn, writes] of plan.scopes) {
    const commit =
      plan.executionAwareRoot && fn === plan.root && sites.length
        ? b.blockStatement(commits)
        : emitter.commitFor(writes);
    if (commit === null) continue;
    emitter.append(fn as HandlerWritePlan['copy'], commit);
    published = true;
  }
  if (sites.length) {
    if (!b.isBlockStatement(plan.copy.body)) {
      throw new Error('memo-dom: execution-aware callback commit did not produce a block body');
    }
    plan.copy.body.body.unshift(
      b.variableDeclaration(
        'let',
        deepestFirst.flatMap((site) => [
          b.variableDeclarator(cloneNode(site.flag), b.booleanLiteral(false)),
          ...site.temporaries.map((temporary) => b.variableDeclarator(cloneNode(temporary))),
        ]),
      ),
    );
  }
  return published;
}

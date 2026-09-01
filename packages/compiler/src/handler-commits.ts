/**
 * handler-commits.ts - write-scope commit construction and insertion.
 *
 * Converts analyzed scope effects into local, routed, or unbounded
 * invalidation statements and inserts them on every normal function exit.
 */

import * as t from '@babel/types';
import {
  cloneNode as cloneEstreeNode,
  ESTREE_VISITOR_KEYS,
} from './ast';
import {
  freshReasonConst,
  freshWriteConst,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
  generatedIdentifier,
  md,
} from './identifiers';

export interface ScopeWrites {
  writes: Set<string>;
  rootFallback: boolean;
  /** This scope writes fields observed by one keyed row. */
  rowLocal: boolean;
  /** This scope may affect the instance-owned collection backing the row. */
  rowOwnerLocal: boolean;
  /** This scope writes state owned by one component instance. */
  instanceLocal: boolean;
  /** Exact instance or prop roots written by this scope. */
  instanceWrites: Set<string>;
  /** Scoped event fallback when a handler has no recognized write. */
  eventOrigin: t.Statement | null;
}

export function createScopeWrites(): ScopeWrites {
  return {
    writes: new Set(),
    rootFallback: false,
    rowLocal: false,
    rowOwnerLocal: false,
    instanceLocal: false,
    instanceWrites: new Set(),
    eventOrigin: null,
  };
}

/** Record an exact write to state owned by one component instance. */
export function recordInstanceWrite(
  scope: ScopeWrites,
  source: string,
): void {
  scope.instanceLocal = true;
  scope.instanceWrites.add(source);
}

/** Build the static commit form for one analyzed function scope. */
export function buildScopeCommit(
  ctx: Ctx,
  scope: ScopeWrites,
  compName: string | null,
  rowCtx?: RowCtx,
): t.Statement | null {
  const rowCommit =
    scope.rowLocal && rowCtx !== undefined
      ? t.expressionStatement(
          rowCtx.refreshVar !== undefined
            ? t.callExpression(t.identifier(rowCtx.refreshVar), [])
            : t.callExpression(md(ctx, 'markDirty'), [
                t.identifier(rowCtx.rowIdVar),
              ]),
        )
      : null;
  let instanceCommit: t.Statement | null = null;
  if (scope.instanceLocal && compName !== null) {
    const reasonIds = ctx.instanceReasonIds.get(compName);
    const reasons = [...scope.instanceWrites]
      .map((source) => reasonIds?.get(source))
      .filter((reason): reason is number => reason !== undefined)
      .sort((a, b) => a - b);
    const exact =
      scope.instanceWrites.size > 0 &&
      reasons.length === scope.instanceWrites.size;
    instanceCommit = t.expressionStatement(
      t.callExpression(md(ctx, 'markDirty'), [
        componentId(ctx, compName),
        ...(exact
          ? [
              reasons.length === 1
                ? t.numericLiteral(reasons[0]!)
                : freshReasonConst(ctx, reasons),
            ]
          : []),
      ]),
    );
  }
  const rowOwnerCommit =
    scope.rowOwnerLocal && rowCtx?.ownerIdVar !== undefined
      ? t.expressionStatement(
          t.callExpression(md(ctx, 'markDirty'), [
            t.identifier(rowCtx.ownerIdVar),
          ]),
        )
      : null;

  const combine = (routed: t.Statement | null): t.Statement | null => {
    const parts: t.Statement[] = [];
    if (scope.eventOrigin !== null) parts.push(scope.eventOrigin);
    if (rowCommit !== null) parts.push(rowCommit);
    if (rowOwnerCommit !== null) parts.push(rowOwnerCommit);
    if (instanceCommit !== null) parts.push(instanceCommit);
    if (routed !== null) parts.push(routed);
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : t.blockStatement(parts);
  };

  if (scope.rootFallback) {
    // The root subtree contains every more precise destination above. Emitting
    // both forms only schedules the same entity twice and obscures why the
    // conservative fallback was selected.
    return t.expressionStatement(
      t.callExpression(md(ctx, 'markDirtySubtree'), [
        t.stringLiteral(ctx.rootId),
      ]),
    );
  }
  if (scope.writes.size === 0) return combine(null);

  const writes = [...scope.writes].sort();
  return combine(
    t.expressionStatement(
      t.callExpression(md(ctx, 'commitWrites'), [
        freshWriteConst(ctx, writes),
      ]),
    ),
  );
}

/** Insert a commit on every normal exit while preserving arrow return values. */
export function appendScopeCommit(
  ctx: Ctx,
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  commit: t.Statement,
): void {
  if (t.isBlockStatement(fn.body)) {
    insertBeforeReturns(fn.body, commit);
    fn.body.body.push(commit);
    return;
  }
  const result = generatedIdentifier(ctx, 'returnValue');
  fn.body = t.blockStatement([
    t.variableDeclaration('const', [
      t.variableDeclarator(result, fn.body as t.Expression),
    ]),
    commit,
    t.returnStatement(cloneEstreeNode(result)),
  ]);
}

function insertBeforeReturns(node: t.Node, commit: t.Statement): void {
  if (t.isFunction(node)) return;
  for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
    const fields = node as unknown as Record<string, unknown>;
    const child = fields[key];
    if (Array.isArray(child)) {
      const children: unknown[] = child;
      for (let index = 0; index < children.length; index++) {
        const item = children[index];
        if (!item || typeof item !== 'object' || !('type' in item)) continue;
        const childNode = item as t.Node;
        if (t.isFunction(childNode)) continue;
        if (t.isReturnStatement(childNode)) {
          children.splice(index, 0, cloneEstreeNode(commit));
          index++;
        } else {
          insertBeforeReturns(childNode, commit);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      const childNode = child as t.Node;
      if (t.isFunction(childNode)) continue;
      if (t.isReturnStatement(childNode)) {
        fields[key] = t.blockStatement([
          cloneEstreeNode(commit),
          childNode,
        ]);
      } else {
        insertBeforeReturns(childNode, commit);
      }
    }
  }
}

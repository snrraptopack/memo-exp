/**
 * handler-commits.ts - write-scope commit construction and insertion.
 *
 * Converts analyzed scope effects into local, routed, or unbounded
 * invalidation statements and inserts them after normal completion.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { appendScopeCommit as appendNormalCompletion } from '../handlers/completion';
import { freshReasonConst, freshWriteConst } from './constants';
import { canonicalStateKey } from '../context';
import type { RowCtx } from './row-context';
import { type DomContext as Ctx } from './context';
import { componentId, generatedIdentifier, md, mdd } from './identifiers';

import type { ScopeWrites } from '../handlers/write-facts';

/** Build the static commit form for one analyzed function scope. */
export function buildScopeCommit(
  ctx: Ctx,
  scope: ScopeWrites,
  compName: string | null,
  rowCtx?: RowCtx,
  eventOriginCommit?: t.Statement,
): t.Statement | null {
  const rowCommit =
    scope.rowLocal && rowCtx !== undefined
      ? astFactory.expressionStatement(
          rowCtx.refreshVar !== undefined
            ? astFactory.callExpression(astFactory.identifier(rowCtx.refreshVar), [])
            : astFactory.callExpression(md(ctx, 'invalidateEntity'), [
                astFactory.identifier(rowCtx.rowIdVar),
              ]),
        )
      : null;
  let instanceCommit: t.Statement | null = null;
  let instanceArguments: t.Expression[] = [];
  if (scope.instanceLocal && compName !== null) {
    const reasonIds = ctx.instanceReasonIds.get(compName);
    const reasons = [...scope.instanceWrites]
      .map((source) => reasonIds?.get(!scope.rootFallback && scope.instanceStructuralWrites.has(source) &&
        !scope.instanceContentWrites.has(source)
        ? ctx.ownerListStructureReasonKeys.get(compName)?.get(source) ?? source : source))
      .filter((reason): reason is number => reason !== undefined)
      .sort((a, b) => a - b);
    const exact =
      scope.instanceWrites.size > 0 &&
      reasons.length === scope.instanceWrites.size;
    instanceArguments = [
      componentId(ctx, compName),
      ...(exact
        ? [
            reasons.length === 1
              ? astFactory.numericLiteral(reasons[0]!)
              : freshReasonConst(ctx, reasons),
          ]
        : []),
    ];
    instanceCommit = astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, instanceArguments.length === 1 ? 'invalidateEntity' : 'markDirty'), instanceArguments),
    );
  }
  const rowOwnerCommit =
    scope.rowOwnerLocal && rowCtx?.ownerIdVar !== undefined
      ? astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'invalidateEntity'), [
            astFactory.identifier(rowCtx.ownerIdVar),
          ]),
        )
      : null;

  const combine = (routed: t.Statement | null): t.Statement | null => {
    const parts: t.Statement[] = [];
    if (!scope.rootFallback) {
      for (const [source, indices] of scope.listItemWrites) {
        if (scope.writes.has(source)) continue;
        parts.push(astFactory.expressionStatement(astFactory.callExpression(
          md(ctx, 'commitListItemWrites'),
          [astFactory.stringLiteral(canonicalStateKey(ctx, source)),
            astFactory.arrayExpression([...indices].map(index => astFactory.numericLiteral(index)))],
        )));
      }
    }
    for (const source of [...scope.transparentWrites].sort()) {
      parts.push(
        astFactory.expressionStatement(
          astFactory.callExpression(mdd(ctx, 'notifyResolvedValueMutation'), [
            astFactory.identifier(source),
          ]),
        ),
      );
    }
    if (scope.eventFallback) {
      if (eventOriginCommit === undefined) throw new Error('memo-dom: missing event-origin lowering');
      parts.push(eventOriginCommit);
    }
    if (rowCommit !== null) parts.push(rowCommit);
    if (rowOwnerCommit !== null) parts.push(rowOwnerCommit);
    if (instanceCommit !== null && !scope.rootFallback) parts.push(instanceCommit);
    if (routed !== null) parts.push(routed);
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : astFactory.blockStatement(parts);
  };

  if (scope.rootFallback) {
    // Publish the exact owner and conservative subtree before scheduling. The
    // owner can be mounted outside the static root; inside it, broad reasons
    // dominate. A synchronous scheduler must not replay the owner twice.
    return combine(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'markDirtySubtree'), [
          astFactory.stringLiteral(ctx.rootId),
          ...(instanceArguments.length > 0 ? instanceArguments
            : compName !== null ? [componentId(ctx, compName)] : []),
        ]),
      ),
    );
  }
  if (scope.writes.size === 0) return combine(null);

  const overlaps = (left: string, right: string): boolean =>
    left === right ||
    left.startsWith(`${right}.`) ||
    right.startsWith(`${left}.`);
  const structural = [...scope.structuralWrites].filter(
    (write) => ![...scope.contentWrites].some((other) => overlaps(write, other)),
  );
  const ordinary = [...scope.writes].filter(
    (write) => !structural.includes(write),
  );
  const routed: t.Statement[] = [];
  if (ordinary.length > 0) {
    routed.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'commitWrites'), [
          freshWriteConst(ctx, ordinary.sort()),
        ]),
      ),
    );
  }
  if (structural.length > 0) {
    routed.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'commitStructuralWrites'), [
          freshWriteConst(ctx, structural.sort()),
        ]),
      ),
    );
  }
  return combine(
    routed.length === 1 ? routed[0]! : astFactory.blockStatement(routed),
  );
}

/** Preserve the DOM emitter's identifier allocation at the shared boundary. */
export function appendScopeCommit(
  ctx: Ctx,
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  commit: t.Statement,
): void {
  appendNormalCompletion(fn, commit, name => generatedIdentifier(ctx, name));
}

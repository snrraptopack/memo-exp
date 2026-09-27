/**
 * Emits dependency-selected replay for component-local derivations.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { canonicalStateKey, freshReasonConst, type Ctx } from '../context';
import { md } from '../identifiers';

/** Runtime protocol: reason attached to a compiler-proven structural write. */
const LIST_STRUCTURE_PREFIX = '\0memo-dom:list-structure:';

function reasonLiteral(reason: number | string): t.Expression {
  if (typeof reason === 'string') return astFactory.stringLiteral(reason);
  return reason < 0
    ? astFactory.unaryExpression('-', astFactory.numericLiteral(-reason), true)
    : astFactory.numericLiteral(reason);
}

/**
 * `_MD.reasonsHit(r, v)` / `_MD.reasonsHit(r, _REASONS_N)`
 *
 * Reasons are a number, a structural-write string, or a Set of either; the
 * runtime helper owns the null/-1/Set dispatch so gates stay one call.
 * Multi-reason gates pass a hoisted const — an inline array literal would
 * allocate on every gated update run.
 */
export function reasonCondition(
  ctx: Ctx,
  reasonVar: string,
  reasons: readonly (number | string)[],
): t.Expression {
  return astFactory.callExpression(md(ctx, 'reasonsHit'), [
    astFactory.identifier(reasonVar),
    reasons.length === 1
      ? reasonLiteral(reasons[0]!)
      : freshReasonConst(ctx, reasons),
  ]);
}

/**
 * A module-state list changed structurally arrives as a string reason, not a
 * numeric id; a calculation reading that list must still replay.
 */
export function structuralReasonsFor(
  ctx: Ctx,
  sources: readonly string[],
): string[] {
  return sources
    .filter((source) => ctx.state.has(source))
    .map((source) => `${LIST_STRUCTURE_PREFIX}${canonicalStateKey(ctx, source)}`);
}

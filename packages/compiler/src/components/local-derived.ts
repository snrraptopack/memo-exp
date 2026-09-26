/**
 * Emits dependency-selected replay for component-local derivations.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';
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
 * `_MD.reasonsHit(r, v)` / `_MD.reasonsHit(r, [a, b, …])`
 *
 * Reasons are a number, a structural-write string, or a Set of either; the
 * runtime helper owns the null/-1/Set dispatch so gates stay one call.
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
      : astFactory.arrayExpression(reasons.map(reasonLiteral)),
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

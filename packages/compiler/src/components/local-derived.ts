/**
 * Emits dependency-selected replay for component-local derivations.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';

/** Runtime protocol: reason attached to a compiler-proven structural write. */
const LIST_STRUCTURE_PREFIX = '\0memo-dom:list-structure:';

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    astFactory.logicalExpression('||', left, right),
  );
}

function reasonLiteral(reason: number | string): t.Expression {
  if (typeof reason === 'string') return astFactory.stringLiteral(reason);
  return reason < 0
    ? astFactory.unaryExpression('-', astFactory.numericLiteral(-reason), true)
    : astFactory.numericLiteral(reason);
}

/**
 * `r === null || r === -1 || r === a || … || (typeof r === 'object' && (r.has(-1) || r.has(a) || …))`
 *
 * Reasons are a number, a structural-write string, or a Set of either; the
 * `typeof r === 'object'` guard keeps a bare string from reaching `.has`.
 */
export function reasonCondition(
  reasonVar: string,
  reasons: readonly (number | string)[],
): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const candidates: (number | string)[] = [-1, ...reasons];
  return or([
    astFactory.binaryExpression('===', current(), astFactory.nullLiteral()),
    ...candidates.map((reason) =>
      astFactory.binaryExpression('===', current(), reasonLiteral(reason)),
    ),
    astFactory.logicalExpression(
      '&&',
      astFactory.binaryExpression(
        '===',
        astFactory.unaryExpression('typeof', current()),
        astFactory.stringLiteral('object'),
      ),
      or(
        candidates.map((reason) =>
          astFactory.callExpression(
            astFactory.memberExpression(current(), astFactory.identifier('has')),
            [reasonLiteral(reason)],
          ),
        ),
      ),
    ),
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

/**
 * Emits dependency-selected replay for component-local derivations.
 */
import * as t from '@babel/types';

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    t.logicalExpression('||', left, right),
  );
}

export function reasonCondition(
  reasonVar: string,
  reasons: number[],
): t.Expression {
  const current = (): t.Identifier => t.identifier(reasonVar);
  const numberMatch = or(
    reasons.map((reason) =>
      t.binaryExpression('===', current(), t.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      t.callExpression(
        t.memberExpression(current(), t.identifier('has')),
        [t.numericLiteral(reason)],
      ),
    ),
  );
  return t.logicalExpression(
    '||',
    t.binaryExpression('===', current(), t.nullLiteral()),
    t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', current()),
        t.stringLiteral('number'),
      ),
      numberMatch,
      setMatch,
    ),
  );
}

/**
 * Emits dependency-selected replay for component-local derivations.
 */
import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    astFactory.logicalExpression('||', left, right),
  );
}

export function reasonCondition(
  reasonVar: string,
  reasons: number[],
): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const volatileMatch = astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.unaryExpression('-', astFactory.numericLiteral(1))),
    astFactory.logicalExpression(
      '&&',
      astFactory.binaryExpression(
        '!==',
        astFactory.unaryExpression('typeof', current()),
        astFactory.stringLiteral('number'),
      ),
      astFactory.callExpression(
        astFactory.memberExpression(current(), astFactory.identifier('has')),
        [astFactory.unaryExpression('-', astFactory.numericLiteral(1))],
      ),
    ),
  );
  const numberMatch = or(
    reasons.map((reason) =>
      astFactory.binaryExpression('===', current(), astFactory.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      astFactory.callExpression(
        astFactory.memberExpression(current(), astFactory.identifier('has')),
        [astFactory.numericLiteral(reason)],
      ),
    ),
  );
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.nullLiteral()),
    astFactory.logicalExpression(
      '||',
      volatileMatch,
      astFactory.conditionalExpression(
        astFactory.binaryExpression(
          '===',
          astFactory.unaryExpression('typeof', current()),
          astFactory.stringLiteral('number'),
        ),
        numberMatch,
        setMatch,
      ),
    ),
  );
}

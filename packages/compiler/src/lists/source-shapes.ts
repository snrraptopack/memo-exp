import * as t from '@babel/types';
import { unwrapTypeExpression } from '../context';

/** Remove transparent TypeScript wrappers around a collection expression. */
export function transparentListExpression(
  expression: t.Expression,
): t.Expression {
  return unwrapTypeExpression(expression);
}

/** A literal primitive list has stable value identity and no mutable source. */
export function isStaticPrimitiveList(
  expression: t.Expression,
): boolean {
  const current = transparentListExpression(expression);
  return (
    t.isArrayExpression(current) &&
    current.elements.every(
      (element) =>
        element !== null &&
        !t.isSpreadElement(element) &&
        (t.isStringLiteral(element) ||
          t.isNumericLiteral(element) ||
          t.isBooleanLiteral(element) ||
          t.isNullLiteral(element) ||
          t.isBigIntLiteral(element)),
    )
  );
}

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

/**
 * A structural method chain rooted at a primitive array literal. The chain
 * shape is recognized structurally — ANY method name is accepted, because
 * the value is fixed at creation regardless of how it was computed. Every
 * argument must be self-contained (inline functions or literals): a
 * reference to an outside binding would make the chain's result depend on
 * mutable state, which requires the reactive derivation path instead.
 */
export function isStaticListExpression(
  expression: t.Expression,
  seen: Set<t.Node> = new Set(),
): boolean {
  const current = transparentListExpression(expression);
  if (seen.has(current)) return false;
  seen.add(current);
  if (isStaticPrimitiveList(current)) return true;
  if (
    t.isCallExpression(current) &&
    (t.isMemberExpression(current.callee) ||
      t.isOptionalMemberExpression(current.callee)) &&
    t.isExpression(current.callee.object)
  ) {
    // Arguments must be self-contained: inline functions or literals.
    for (const argument of current.arguments) {
      if (argument === null || t.isSpreadElement(argument)) return false;
      if (
        !t.isArrowFunctionExpression(argument) &&
        !t.isFunctionExpression(argument) &&
        !t.isStringLiteral(argument) &&
        !t.isNumericLiteral(argument) &&
        !t.isBooleanLiteral(argument)
      ) {
        return false;
      }
    }
    return isStaticListExpression(
      current.callee.object as t.Expression,
      seen,
    );
  }
  return false;
}

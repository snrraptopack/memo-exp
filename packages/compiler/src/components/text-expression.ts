/** Shared JSX text join semantics for initial content and DOM update emission. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';

export function combineTextExpressions(expressions: readonly t.Expression[]): t.Expression {
  if (expressions.length === 1) return expressions[0]!;
  const merged: t.Expression[] = [];
  for (const expr of expressions) {
    const last = merged[merged.length - 1];
    if (last && astFactory.isStringLiteral(last) && astFactory.isStringLiteral(expr)) {
      merged[merged.length - 1] = astFactory.stringLiteral(last.value + expr.value);
    } else merged.push(expr);
  }
  if (merged.length === 1) return merged[0]!;
  const hasString = merged.some(expr => astFactory.isStringLiteral(expr));
  let result = hasString ? merged[0]! : astFactory.binaryExpression('+', astFactory.stringLiteral(''), merged[0]!);
  for (let index = 1; index < merged.length; index++) {
    result = astFactory.binaryExpression('+', result, merged[index]!);
  }
  return result;
}

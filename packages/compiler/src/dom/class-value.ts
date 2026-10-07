import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';

/** Normalize literal class branches without changing condition evaluation. */
export function literalClassValue(expression: t.Expression): t.Expression | null {
  if (astFactory.isStringLiteral(expression)) {
    return astFactory.stringLiteral(expression.value.trim());
  }
  if (!astFactory.isConditionalExpression(expression)) return null;
  const consequent = literalClassValue(expression.consequent);
  const alternate = literalClassValue(expression.alternate);
  if (consequent === null || alternate === null) return null;
  return astFactory.conditionalExpression(cloneNode(expression.test), consequent, alternate);
}

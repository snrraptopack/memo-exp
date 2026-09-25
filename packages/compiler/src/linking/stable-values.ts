/** Primitive const exports can be read as stable values across linked modules. */
import * as ast from '../ast/factory';
import type { Binding } from '../ast';
import { unwrapTypeExpression } from '../context/ast';

export function isStablePrimitiveBinding(binding: Binding | undefined, name: string): boolean {
  if (binding?.kind !== 'const' || binding.constantViolations.length > 0 ||
      !ast.isVariableDeclaration(binding.declarationNode)) {
    return false;
  }
  const declarator = binding.declarationNode.declarations.find(item =>
    ast.isIdentifier(item.id) && item.id.name === name);
  if (declarator?.init == null) return false;
  const value = unwrapTypeExpression(declarator.init);
  return ast.isNumericLiteral(value) || ast.isStringLiteral(value) ||
    ast.isBooleanLiteral(value) || ast.isNullLiteral(value) ||
    ast.isBigIntLiteral(value) ||
    ast.isUnaryExpression(value) &&
      (value.operator === '+' || value.operator === '-') &&
      ast.isNumericLiteral(value.argument);
}

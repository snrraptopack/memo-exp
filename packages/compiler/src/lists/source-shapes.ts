import type { BaseNode } from '../ast';
import { unwrapTypeExpression } from '../context';

/** Remove transparent TypeScript wrappers around a collection expression. */
export function transparentListExpression<TExpression extends BaseNode>(
  expression: TExpression,
): TExpression {
  return unwrapTypeExpression(expression);
}

function field(node: BaseNode, name: string): unknown {
  return (node as unknown as Record<string, unknown>)[name];
}

function isNode(value: unknown): value is BaseNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isPrimitiveLiteral(node: BaseNode): boolean {
  if (
    node.type === 'StringLiteral' ||
    node.type === 'NumericLiteral' ||
    node.type === 'BooleanLiteral' ||
    node.type === 'NullLiteral' ||
    node.type === 'BigIntLiteral'
  ) {
    return true;
  }
  if (node.type !== 'Literal') return false;
  const value = field(node, 'value');
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  );
}

function isInlineArgument(node: BaseNode): boolean {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'StringLiteral' ||
    node.type === 'NumericLiteral' ||
    node.type === 'BooleanLiteral' ||
    (node.type === 'Literal' &&
      ['string', 'number', 'boolean'].includes(typeof field(node, 'value')))
  );
}

/** A literal primitive list has stable value identity and no mutable source. */
export function isStaticPrimitiveList(expression: BaseNode): boolean {
  const current = transparentListExpression(expression);
  if (current.type !== 'ArrayExpression') return false;
  const elements = field(current, 'elements');
  return (
    Array.isArray(elements) &&
    elements.every(
      (element) =>
        isNode(element) &&
        element.type !== 'SpreadElement' &&
        isPrimitiveLiteral(element),
    )
  );
}

/**
 * A structural method chain rooted at a primitive array literal. The chain
 * shape is recognized structurally: any method name is accepted, because
 * the value is fixed at creation regardless of how it was computed. Every
 * argument must be self-contained (inline functions or literals): a
 * reference to an outside binding would make the chain's result depend on
 * mutable state, which requires the reactive derivation path instead.
 */
export function isStaticListExpression(
  expression: BaseNode,
  seen: Set<BaseNode> = new Set(),
): boolean {
  const current = transparentListExpression(expression);
  if (seen.has(current)) return false;
  seen.add(current);
  if (isStaticPrimitiveList(current)) return true;
  if (current.type === 'CallExpression') {
    const callee = field(current, 'callee');
    if (
      !isNode(callee) ||
      (callee.type !== 'MemberExpression' &&
        callee.type !== 'OptionalMemberExpression')
    ) {
      return false;
    }
    const source = field(callee, 'object');
    const args = field(current, 'arguments');
    if (!isNode(source) || !Array.isArray(args)) return false;

    // Arguments must be self-contained: inline functions or literals.
    for (const argument of args) {
      if (!isNode(argument) || !isInlineArgument(argument)) return false;
    }
    return isStaticListExpression(source, seen);
  }
  return false;
}

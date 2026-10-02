import { childNode, childNodes, nodeField, type BaseNode } from '../ast';

const SCALAR_BINARY_OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^',
  '<', '<=', '>', '>=', '==', '!=', '===', '!==',
]);

/** Shared primitive grammar; lexical eligibility belongs to the caller. */
export function isPlainScalarValue(
  node: BaseNode | null,
  identifierIsScalar: (identifier: BaseNode) => boolean,
  primitiveMember?: (member: BaseNode) => boolean,
): boolean {
  if (node === null) return false;
  if (node.type === 'Literal') return nodeField(node, 'value') === null ||
    ['string', 'number', 'boolean'].includes(typeof nodeField(node, 'value'));
  if (node.type === 'Identifier') return identifierIsScalar(node);
  if (node.type === 'MemberExpression') return primitiveMember?.(node) === true;
  const scalar = (value: BaseNode | null): boolean => isPlainScalarValue(value, identifierIsScalar, primitiveMember);
  if (node.type === 'BinaryExpression' && SCALAR_BINARY_OPERATORS.has(String(nodeField(node, 'operator'))) ||
      node.type === 'LogicalExpression' && ['&&', '||', '??'].includes(String(nodeField(node, 'operator')))) {
    return scalar(childNode(node, 'left')) && scalar(childNode(node, 'right'));
  }
  if (node.type === 'ConditionalExpression') return scalar(childNode(node, 'test')) &&
    scalar(childNode(node, 'consequent')) && scalar(childNode(node, 'alternate'));
  if (node.type === 'TemplateLiteral') return childNodes(node, 'expressions').every(scalar);
  return node.type === 'UnaryExpression' && ['+', '-', '!', '~'].includes(String(nodeField(node, 'operator'))) &&
    scalar(childNode(node, 'argument'));
}

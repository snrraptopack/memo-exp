import type { BaseNode } from './types';

/** View a parser-neutral node as its dynamically keyed ESTree fields. */
export function nodeFields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

/** Whether an unknown value is an ESTree-compatible node. */
export function isNode(value: unknown): value is BaseNode {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string';
}

/** Return an ESTree node when the unknown value has a node discriminator. */
export function asNode(value: unknown): BaseNode | null {
  return isNode(value) ? value : null;
}

/** Read one dynamically keyed ESTree field. */
export function nodeField(parent: BaseNode, key: string): unknown {
  return nodeFields(parent)[key];
}

/** Keep only ESTree nodes from an unknown array value. */
export function nodeArray(value: unknown): BaseNode[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/** Read one optional child node without coupling analysis to a parser AST type. */
export function childNode(parent: BaseNode, key: string): BaseNode | null {
  return asNode(nodeField(parent, key));
}

/** Read a child-node array while ignoring parser metadata and null slots. */
export function childNodes(parent: BaseNode, key: string): BaseNode[] {
  return nodeArray(nodeField(parent, key));
}

/** Read a JavaScript identifier name from an unknown AST value. */
export function identifierName(value: unknown): string | null {
  const node = asNode(value);
  if (node?.type !== 'Identifier') return null;
  const name = nodeField(node, 'name');
  return typeof name === 'string' ? name : null;
}

/** Read an Identifier or JSXIdentifier name. */
export function identifierLikeName(value: unknown): string | null {
  const node = asNode(value);
  if (node?.type !== 'Identifier' && node?.type !== 'JSXIdentifier') {
    return null;
  }
  const name = nodeField(node, 'name');
  return typeof name === 'string' ? name : null;
}

/** Read a JSXIdentifier name from an unknown AST value. */
export function jsxIdentifierName(value: unknown): string | null {
  const node = asNode(value);
  if (node?.type !== 'JSXIdentifier') return null;
  const name = nodeField(node, 'name');
  return typeof name === 'string' ? name : null;
}

/** Read a parser-neutral string literal value. */
export function stringValue(value: unknown): string | null {
  const node = asNode(value);
  if (node?.type !== 'StringLiteral' && node?.type !== 'Literal') return null;
  const literal = nodeField(node, 'value');
  return typeof literal === 'string' ? literal : null;
}

/** ESTree nodes that introduce a nested function execution boundary. */
export const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

export function isFunctionNode(node: BaseNode): boolean {
  return FUNCTION_NODE_TYPES.has(node.type);
}

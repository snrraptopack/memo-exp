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

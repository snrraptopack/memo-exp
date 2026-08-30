/**
 * Pure AST transformer for @memoized-dom/compiler.
 *
 * Provides functional tree rewrites (replace / remove / splice)
 * without mutable NodePath traversal lifecycles.
 */

import type { BaseNode } from './types';
import { cloneNode } from './builders';
import { ESTREE_VISITOR_KEYS } from './walk';

export type TransformResult = BaseNode | BaseNode[] | null | undefined | void;

export interface ASTTransformer {
  enter?: (
    node: BaseNode,
    parent: BaseNode | null,
    key?: string,
    index?: number,
  ) => TransformResult;
  leave?: (
    node: BaseNode,
    parent: BaseNode | null,
    key?: string,
    index?: number,
  ) => TransformResult;
}

function nodeFields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

/**
 * Transform an AST tree purely.
 * - Return `null` to remove a node.
 * - Return a new `BaseNode` to replace it.
 * - Return `BaseNode[]` to splice multiple nodes in place (when in an array).
 * - Return `undefined` to keep the node untouched.
 */
export function transformAst<T extends BaseNode = BaseNode>(
  root: T,
  transformer: ASTTransformer,
): T | null {
  function visit(
    node: BaseNode,
    parent: BaseNode | null,
    key?: string,
    index?: number,
  ): BaseNode | BaseNode[] | null {
    let current: BaseNode = node;

    // 1. Enter phase
    if (transformer.enter) {
      const enterResult = transformer.enter(current, parent, key, index);
      if (enterResult !== undefined) {
        if (enterResult === null) return null;
        if (Array.isArray(enterResult)) {
          return enterResult;
        }
        current = cloneNode(enterResult);
      }
    }

    // 2. Transform children
    const keys = ESTREE_VISITOR_KEYS[current.type] ?? Object.keys(current);
    for (const childKey of keys) {
      const child = nodeFields(current)[childKey];
      if (Array.isArray(child)) {
        const items: readonly unknown[] = child;
        const nextArray: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item && typeof item === 'object' && 'type' in item) {
            const transformed = visit(item as BaseNode, current, childKey, i);
            if (transformed === null) {
              // Node removed - do not push
              continue;
            } else if (Array.isArray(transformed)) {
              nextArray.push(...transformed);
            } else {
              nextArray.push(transformed);
            }
          } else {
            nextArray.push(item);
          }
        }
        nodeFields(current)[childKey] = nextArray;
      } else if (child && typeof child === 'object' && 'type' in child) {
        const transformed = visit(child as BaseNode, current, childKey, undefined);
        if (Array.isArray(transformed)) {
          throw new TypeError(
            `Cannot splice nodes into non-array field ${current.type}.${childKey}`,
          );
        }
        nodeFields(current)[childKey] = transformed;
      }
    }

    // 3. Leave phase
    if (transformer.leave) {
      const leaveResult = transformer.leave(current, parent, key, index);
      if (leaveResult !== undefined) {
        return leaveResult;
      }
    }

    return current;
  }

  const result = visit(cloneNode(root), null, undefined, undefined);
  if (Array.isArray(result)) {
    throw new TypeError('Cannot splice nodes at the AST root');
  }
  return result as T | null;
}

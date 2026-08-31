import type { BaseNode } from './types';
import type { ScopeAnalysis } from './scope';

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function location(
  analysis: ScopeAnalysis,
  target: BaseNode,
): { parent: BaseNode; key: string } {
  const parent = analysis.parentByNode.get(target) ?? null;
  const key = analysis.keyByNode.get(target);
  if (parent === null || key === undefined) {
    throw new TypeError(`Cannot mutate detached AST node ${target.type}`);
  }
  return { parent, key };
}

/** Replace a non-root node through parser-neutral parent metadata. */
export function replaceNode(
  analysis: ScopeAnalysis,
  target: BaseNode,
  replacement: BaseNode,
): void {
  const { parent, key } = location(analysis, target);
  const value = fields(parent)[key];
  if (Array.isArray(value)) {
    const index = value.indexOf(target);
    if (index === -1) throw new TypeError('AST replacement target is stale');
    value[index] = replacement;
    return;
  }
  if (value !== target) throw new TypeError('AST replacement target is stale');
  fields(parent)[key] = replacement;
}

/**
 * Overwrite a node in place while preserving its object identity.
 *
 * This is useful at temporary frontend-adapter boundaries where a live path
 * may still retain the node object while parser-neutral mutation owns its
 * fields. Rebuild scope/parent analysis after the surrounding batch.
 */
export function overwriteNode(target: BaseNode, replacement: BaseNode): void {
  const targetFields = fields(target);
  for (const key of Object.keys(targetFields)) delete targetFields[key];
  Object.assign(targetFields, fields(replacement));
}

/** Remove a node held in an array-valued parent field. */
export function removeNode(
  analysis: ScopeAnalysis,
  target: BaseNode,
): void {
  const { parent, key } = location(analysis, target);
  const value = fields(parent)[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`Cannot remove scalar AST field ${parent.type}.${key}`);
  }
  const index = value.indexOf(target);
  if (index === -1) throw new TypeError('AST removal target is stale');
  value.splice(index, 1);
}

/** Whether a node is equal to or nested within an ancestor. */
export function nodeIsWithin(
  analysis: ScopeAnalysis,
  target: BaseNode,
  ancestor: BaseNode,
): boolean {
  let current: BaseNode | null = target;
  while (current !== null) {
    if (current === ancestor) return true;
    current = analysis.parentByNode.get(current) ?? null;
  }
  return false;
}

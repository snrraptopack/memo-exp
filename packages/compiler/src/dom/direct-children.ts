import type * as t from '../ast/compiler-types';
import type { DirectChildPlan, JsxNode } from '../jsx/children';

export type DirectChildOperation =
  | { type: 'node'; variable: string }
  | Exclude<DirectChildPlan, { type: 'text' | 'node' }>;

/** Materialize a semantic child plan before inserting into its DOM parent. */
export function materializeDirectChildren(
  plan: readonly DirectChildPlan[],
  emitters: {
    emitText(expression: t.Expression): string;
    emitNode(node: JsxNode): string;
  },
): DirectChildOperation[] {
  return plan.map(child => {
    if (child.type === 'text') {
      return { type: 'node', variable: emitters.emitText(child.expression) };
    }
    if (child.type === 'node') {
      return { type: 'node', variable: emitters.emitNode(child.node) };
    }
    return child;
  });
}

import * as t from '@babel/types';

export type RuntimeBindingPattern =
  | t.Identifier
  | t.ObjectPattern
  | t.ArrayPattern;

/**
 * Clone an authored TypeScript binding pattern for generated JavaScript.
 * Babel stores annotations on nested pattern nodes, so clear every supported
 * binding shape rather than only the root.
 */
export function cloneRuntimeBindingPattern(
  pattern: RuntimeBindingPattern,
): RuntimeBindingPattern {
  const cloned = t.cloneNode(pattern, true);
  t.traverseFast(cloned, (node) => {
    if (
      t.isIdentifier(node) ||
      t.isObjectPattern(node) ||
      t.isArrayPattern(node) ||
      t.isRestElement(node) ||
      t.isAssignmentPattern(node)
    ) {
      node.typeAnnotation = null;
    }
  });
  return cloned;
}

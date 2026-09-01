import { cloneNode, walkAst, type BaseNode } from '../ast';

const ANNOTATED_PATTERN_NODES = new Set([
  'Identifier',
  'ObjectPattern',
  'ArrayPattern',
  'RestElement',
  'AssignmentPattern',
]);

/**
 * Clone an authored TypeScript binding pattern for generated JavaScript.
 * Parsers may store annotations on nested pattern nodes, so clear every supported
 * binding shape rather than only the root.
 */
export function cloneRuntimeBindingPattern<TPattern extends BaseNode>(
  pattern: TPattern,
): TPattern {
  const cloned = cloneNode(pattern);
  walkAst(cloned, {
    enter(node) {
      if (ANNOTATED_PATTERN_NODES.has(node.type)) {
        (node as unknown as Record<string, unknown>).typeAnnotation = null;
      }
    },
  });
  return cloned;
}

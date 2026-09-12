/**
 * Direct-call classification for event handlers.
 *
 * A handler that only delegates to component-local helpers which already
 * own a synchronous commit does not need a second event-origin invalidation.
 * Calls inside nested callbacks are deliberately ignored: those callbacks
 * have their own execution boundary and are instrumented separately.
 */

import { nodeFields as fields, walkAst, type BaseNode } from '../ast';

const FUNCTION_NODES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

function identifierName(value: unknown): string | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { type?: unknown }).type !== 'Identifier'
  ) {
    return null;
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

export function callsOnlyCommittedLocalHelpers(
  root: BaseNode,
  isCommittedHelper: (name: string) => boolean,
): boolean {
  let sawCall = false;
  let valid = true;

  walkAst<BaseNode>(root, {
    enter(current) {
      if (!valid) return false;
      if (current !== root && FUNCTION_NODES.has(current.type)) return false;
      if (
        current.type !== 'CallExpression' &&
        current.type !== 'OptionalCallExpression'
      ) {
        return;
      }
      sawCall = true;
      const name = identifierName(fields(current).callee);
      if (name === null || !isCommittedHelper(name)) {
        valid = false;
        return false;
      }
    },
  });

  return sawCall && valid;
}

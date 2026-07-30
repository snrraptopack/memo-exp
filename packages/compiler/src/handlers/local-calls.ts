/**
 * Direct-call classification for event handlers.
 *
 * A handler that only delegates to component-local helpers which already
 * own a synchronous commit does not need a second event-origin invalidation.
 * Calls inside nested callbacks are deliberately ignored: those callbacks
 * have their own execution boundary and are instrumented separately.
 */

import * as t from '@babel/types';
import type { HandlerFn } from '../handlers';

export function callsOnlyCommittedLocalHelpers(
  root: HandlerFn,
  isCommittedHelper: (name: string) => boolean,
): boolean {
  let sawCall = false;
  let valid = true;

  const visit = (node: t.Node): void => {
    if (!valid) return;
    if (node !== root && t.isFunction(node)) return;

    if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
      sawCall = true;
      if (!t.isIdentifier(node.callee) || !isCommittedHelper(node.callee.name)) {
        valid = false;
        return;
      }
    }

    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item !== null && typeof item === 'object' && 'type' in item) {
            visit(item as t.Node);
          }
        }
      } else if (
        child !== null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        visit(child as t.Node);
      }
    }
  };

  visit(root);
  return sawCall && valid;
}

/** Shared host-event shape facts used by analysis, linking, and emission. */

import {
  asNode as node,
  jsxIdentifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
} from '../ast';

export function hostJsxEventNames(body: BaseNode): string[] {
  const found = new Set<string>();
  walkAst<BaseNode>(body, {
    enter(current) {
      if (current.type !== 'JSXOpeningElement') return;
      const currentFields = fields(current);
      const tag = jsxIdentifierName(currentFields.name);
      if (tag === null || !/^[a-z]/.test(tag)) return;
      const attributes = Array.isArray(currentFields.attributes)
        ? currentFields.attributes as readonly unknown[]
        : [];
      for (const value of attributes) {
        const attribute = node(value);
        if (attribute?.type !== 'JSXAttribute') continue;
        const name = jsxIdentifierName(fields(attribute).name);
        if (name !== null && /^on[A-Z]/.test(name)) found.add(name);
      }
    },
  });
  return [...found].sort();
}

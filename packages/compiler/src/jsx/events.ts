/** Shared host-event shape facts used by analysis, linking, and emission. */

import * as t from '@babel/types';
import { walkNodes } from '../context';

export function hostJsxEventNames(body: t.Node): string[] {
  const found = new Set<string>();
  walkNodes(body, (node) => {
    if (!t.isJSXOpeningElement(node)) return;
    const tag = node.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) return;
    for (const attribute of node.attributes) {
      if (
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name) &&
        /^on[A-Z]/.test(attribute.name.name)
      ) {
        found.add(attribute.name.name);
      }
    }
  });
  return [...found].sort();
}

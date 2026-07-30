/** Shared host-event shape facts used by analysis, linking, and emission. */

import * as t from '@babel/types';
import { walkNodes } from '../context';

export function hasHostJsxEvent(body: t.BlockStatement): boolean {
  let found = false;
  walkNodes(body, (node) => {
    if (found || !t.isJSXOpeningElement(node)) return;
    const tag = node.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) return;
    found = node.attributes.some(
      (attribute) =>
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name) &&
        /^on[A-Z]/.test(attribute.name.name),
    );
  });
  return found;
}

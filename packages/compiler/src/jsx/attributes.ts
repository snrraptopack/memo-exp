/**
 * jsx/attributes.ts - authored JSX attribute planning.
 *
 * Spread-bearing hosts and component calls must preserve source-order
 * overrides. Planning captures their values and event override boundaries
 * without constructing backend objects or instrumenting callbacks.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
} from '../ast';

export type OrderedAttributeEntry =
  | { type: 'spread'; value: t.Expression }
  | { type: 'attribute'; name: string; value: t.Expression; event: boolean };

export interface OrderedAttributePlan {
  entries: readonly OrderedAttributeEntry[];
  /** Explicit events after the last spread cannot be dynamically overridden. */
  safeEventKeys: string[];
}

export interface OrderedAttributeOptions {
  skipKey?: boolean;
  fail(message: string): never;
}

/** Capture authored order and values without choosing an emission target. */
export function planOrderedAttributes(
  attributes: readonly (t.JSXAttribute | t.JSXSpreadAttribute)[],
  options: OrderedAttributeOptions,
): OrderedAttributePlan {
  const entries: OrderedAttributeEntry[] = [];
  let lastSpread = -1;
  for (let index = 0; index < attributes.length; index++) {
    if (astFactory.isJSXSpreadAttribute(attributes[index]!)) lastSpread = index;
  }
  const safeEventKeys: string[] = [];

  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index]!;
    if (astFactory.isJSXSpreadAttribute(attribute)) {
      entries.push({type:'spread', value:cloneEstreeNode(attribute.argument)});
      continue;
    }

    const name = jsxAttributeName(attribute.name);
    if (name === 'key' && options.skipKey) continue;
    const event = /^on[A-Z]/.test(name);
    entries.push({type:'attribute', name, value:jsxAttributeValue(attribute, options.fail), event});
    if (event && index > lastSpread) {
      safeEventKeys.push(name);
    }
  }
  return {
    entries,
    safeEventKeys,
  };
}

export function jsxAttributeName(
  name: t.JSXIdentifier | t.JSXNamespacedName,
): string {
  return astFactory.isJSXIdentifier(name)
    ? name.name
    : `${name.namespace.name}:${name.name.name}`;
}

function jsxAttributeValue(
  attribute: t.JSXAttribute,
  fail: (message: string) => never,
): t.Expression {
  if (attribute.value == null) return astFactory.booleanLiteral(true);
  if (astFactory.isStringLiteral(attribute.value)) {
    return cloneEstreeNode(attribute.value);
  }
  if (
    astFactory.isJSXExpressionContainer(attribute.value) &&
    astFactory.isExpression(attribute.value.expression)
  ) {
    return cloneEstreeNode(attribute.value.expression);
  }
  return fail(
    `memo-dom: attribute '${jsxAttributeName(
      attribute.name,
    )}' must contain a JavaScript expression`,
  );
}

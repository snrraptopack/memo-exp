/**
 * jsx/attributes.ts - ordered JSX attribute object construction.
 *
 * Spread-bearing hosts and component calls must preserve source-order
 * overrides. This module converts attributes into one object expression while
 * delegating explicit event instrumentation to the owning emitter.
 */

import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
} from '../ast';

export interface OrderedAttributes {
  expression: t.ObjectExpression;
  sources: t.Expression[];
  /** Explicit events after the last spread cannot be dynamically overridden. */
  safeEventKeys: string[];
}

export interface OrderedAttributeOptions {
  skipKey?: boolean;
  eventValue?: (name: string, value: t.Expression) => t.Expression;
  attributeValue?: (name: string, value: t.Expression) => t.Expression;
  fail(message: string): never;
}

/** Build one JavaScript object with normal spread override semantics. */
export function buildOrderedAttributes(
  attributes: readonly (t.JSXAttribute | t.JSXSpreadAttribute)[],
  options: OrderedAttributeOptions,
): OrderedAttributes {
  const properties: Array<t.ObjectProperty | t.SpreadElement> = [];
  const sources: t.Expression[] = [];
  let lastSpread = -1;
  for (let index = 0; index < attributes.length; index++) {
    if (astFactory.isJSXSpreadAttribute(attributes[index]!)) lastSpread = index;
  }
  const safeEventKeys: string[] = [];

  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index]!;
    if (astFactory.isJSXSpreadAttribute(attribute)) {
      properties.push(astFactory.spreadElement(cloneEstreeNode(attribute.argument)));
      sources.push(cloneEstreeNode(attribute.argument));
      continue;
    }

    const name = jsxAttributeName(attribute.name);
    if (name === 'key' && options.skipKey) continue;
    const sourceValue = jsxAttributeValue(attribute, options.fail);
    const value =
      options.attributeValue?.(name, sourceValue) ?? sourceValue;
    const event =
      /^on[A-Z]/.test(name) && options.eventValue !== undefined
        ? options.eventValue(name, value)
        : value;
    properties.push(
      astFactory.objectProperty(
        isValidEstreeIdentifier(name)
          ? astFactory.identifier(name)
          : astFactory.stringLiteral(name),
        event,
        false,
        astFactory.isIdentifier(event) && event.name === name,
      ),
    );
    sources.push(cloneEstreeNode(sourceValue));
    if (/^on[A-Z]/.test(name) && index > lastSpread) {
      safeEventKeys.push(name);
    }
  }
  return {
    expression: astFactory.objectExpression(properties),
    sources,
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

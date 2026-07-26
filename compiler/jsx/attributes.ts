/**
 * jsx/attributes.ts - ordered JSX attribute object construction.
 *
 * Spread-bearing hosts and component calls must preserve source-order
 * overrides. This module converts attributes into one object expression while
 * delegating explicit event instrumentation to the owning emitter.
 */

import * as t from '@babel/types';

export interface OrderedAttributes {
  expression: t.ObjectExpression;
  sources: t.Expression[];
  /** Explicit events after the last spread cannot be dynamically overridden. */
  safeEventKeys: string[];
}

export interface OrderedAttributeOptions {
  skipKey?: boolean;
  eventValue?: (name: string, value: t.Expression) => t.Expression;
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
    if (t.isJSXSpreadAttribute(attributes[index]!)) lastSpread = index;
  }
  const safeEventKeys: string[] = [];

  for (let index = 0; index < attributes.length; index++) {
    const attribute = attributes[index]!;
    if (t.isJSXSpreadAttribute(attribute)) {
      properties.push(t.spreadElement(t.cloneNode(attribute.argument)));
      sources.push(t.cloneNode(attribute.argument));
      continue;
    }

    const name = jsxAttributeName(attribute.name);
    if (name === 'key' && options.skipKey) continue;
    const value = jsxAttributeValue(attribute, options.fail);
    const event =
      /^on[A-Z]/.test(name) && options.eventValue !== undefined
        ? options.eventValue(name, value)
        : value;
    properties.push(
      t.objectProperty(
        t.isValidIdentifier(name)
          ? t.identifier(name)
          : t.stringLiteral(name),
        event,
        false,
        t.isIdentifier(event) && event.name === name,
      ),
    );
    sources.push(t.cloneNode(value));
    if (/^on[A-Z]/.test(name) && index > lastSpread) {
      safeEventKeys.push(name);
    }
  }
  return {
    expression: t.objectExpression(properties),
    sources,
    safeEventKeys,
  };
}

export function jsxAttributeName(
  name: t.JSXIdentifier | t.JSXNamespacedName,
): string {
  return t.isJSXIdentifier(name)
    ? name.name
    : `${name.namespace.name}:${name.name.name}`;
}

function jsxAttributeValue(
  attribute: t.JSXAttribute,
  fail: (message: string) => never,
): t.Expression {
  if (attribute.value == null) return t.booleanLiteral(true);
  if (t.isStringLiteral(attribute.value)) {
    return t.cloneNode(attribute.value);
  }
  if (
    t.isJSXExpressionContainer(attribute.value) &&
    t.isExpression(attribute.value.expression)
  ) {
    return t.cloneNode(attribute.value.expression);
  }
  return fail(
    `memo-dom: attribute '${jsxAttributeName(
      attribute.name,
    )}' must contain a JavaScript expression`,
  );
}

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

/** Static data-property names are shared by contract discovery and lowering. */
export function staticAttributePropertyName(property: t.Node): string | null {
  if (!astFactory.isObjectProperty(property)) {
    return null;
  }

  const source = property as t.ObjectProperty & { kind?: string; method?: boolean };

  if (
    property.computed ||
    source.method === true ||
    (source.kind !== undefined && source.kind !== 'init')
  ) {
    return null;
  }

  return astFactory.isIdentifier(property.key)
    ? property.key.name
    : astFactory.isStringLiteral(property.key) || astFactory.isNumericLiteral(property.key)
      ? String(property.key.value)
      : null;
}

/**
 * Proven named values for component contract discovery, retaining source AST
 * references for binding-aware alias analysis. Later known properties override
 * earlier ones; opaque spreads contribute no guessed property contract.
 * This projection never evaluates or changes the emitted attribute program.
 */
export function sourceAttributeValues(
  attributes: readonly (t.JSXAttribute | t.JSXSpreadAttribute)[],
): readonly { readonly name: string; readonly value: t.Expression }[] {
  const values = new Map<string, t.Expression>();

  const visitSpread = (expression: t.Expression): void => {
    if (!astFactory.isObjectExpression(expression)) {
      return;
    }

    for (const property of expression.properties) {
      if (astFactory.isSpreadElement(property)) {
        visitSpread(property.argument);
        continue;
      }

      const name = staticAttributePropertyName(property);

      if (name === null || !astFactory.isObjectProperty(property) || !astFactory.isExpression(property.value)) {
        continue;
      }

      values.set(name, property.value);
    }
  };

  for (const attribute of attributes) {
    if (astFactory.isJSXSpreadAttribute(attribute)) {
      visitSpread(attribute.argument);
    } else {
      values.set(jsxAttributeName(attribute.name), jsxAttributeValue(attribute, message => {
        throw new Error(message);
      }));
    }
  }

  return [...values].map(([name, value]) => ({ name, value }));
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
    entries.push({type:'attribute', name, value:cloneEstreeNode(jsxAttributeValue(attribute, options.fail)), event});
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
    return attribute.value;
  }
  if (
    astFactory.isJSXExpressionContainer(attribute.value) &&
    astFactory.isExpression(attribute.value.expression)
  ) {
    return attribute.value.expression;
  }
  return fail(
    `memo-dom: attribute '${jsxAttributeName(
      attribute.name,
    )}' must contain a JavaScript expression`,
  );
}

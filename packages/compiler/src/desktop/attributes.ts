/** Translate shared attribute plans into native destinations and event slots. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { unwrapTypeExpression } from '../ast/normalize';
import { normalizeCssPropertyName } from '@tsrx/core';
import { desktopInlineDeclarations, type DesktopDeclaration } from './css';
import capabilities from './capabilities.json';
import { planOrderedAttributes } from '../jsx/attributes';
import { emitOrderedAttributes } from '../emission/ordered-attributes';
import type { ComponentCallbacks, CallbackSourcePlan } from '../planning/component-callbacks';
import type { HandlerWritePlan } from '../handlers/plan';
import { valueExpression } from './value';
import {
  desktopEventNames,
  lowerDesktopEvent,
  instrumentPropertyEvent,
  instrumentSpreadEvents,
  reserveDesktopEvents,
  type DesktopEventType,
} from './events';

export function lowerDesktopAttributes(
  opening: t.JSXOpeningElement,
  tag: string,
  node: number,
  destinations: {
    events: { node: number; type: DesktopEventType }[];
    handlers: t.Expression[];
    refs: t.Expression[];
    properties: t.Expression[];
    setup: t.Statement[];
  },
  options: {
    callbacks: ComponentCallbacks;
    instrument: t.Identifier;
    attributes: t.Identifier;
    lexical?: boolean;
    fresh(name: string): t.Identifier;
    fail(message: string, at: t.Node): never;
    refValue(expression: t.Expression): t.Expression;
    routeWrites(plan: HandlerWritePlan): void;
    moduleCallback(expression: t.Expression): CallbackSourcePlan | null;
    addValue(expression: t.Expression, node: number): void;
  },
) {
  const { refs, properties, setup } = destinations;
  const { instrument } = options;
  const fail: (message: string, at: t.Node) => never = options.fail;
  const stableRef = (expression: t.Expression): t.Expression => {
    const value = options.refValue(expression);
    if (
      b.isArrowFunctionExpression(value) ||
      b.isFunctionExpression(value) ||
      (b.isCallExpression(value) &&
        b.isMemberExpression(value.callee) &&
        b.isIdentifier(value.callee.property, { name: 'refAssign' }))
    ) {
      const ref = options.fresh('__desktopRef');
      setup.push(b.variableDeclaration('const', [b.variableDeclarator(ref, value)]));
      return ref;
    }
    return value;
  };
  const capability = (
    capabilities.tags as Record<string, { attributes: string[]; events: string[] }>
  )[tag];
  if (!capability) fail(`unsupported desktop tag <${tag}>`, opening);
  const attributes: Record<string, string> = {};
  const style: DesktopDeclaration[] = [];
  const eventTypes = new Set<string>();
  const seen = new Set<string>();
  const attributePlan = planOrderedAttributes(opening.attributes, {
    cloneExpressions: false,
    fail: (message) => fail(message, opening),
  });
  const hasDynamicProperties = attributePlan.entries.some((entry) => {
    if (entry.type === 'spread') return true;
    if (entry.event || ['ref', 'key', 'value'].includes(entry.name)) return false;
    const value = unwrapTypeExpression(entry.value);
    if (b.isStringLiteral(value)) return false;
    if (entry.name === 'style' && b.isObjectExpression(value)) {
      return value.properties.some(
        (property) =>
          !b.isObjectProperty(property) ||
          property.computed ||
          (!b.isStringLiteral(property.value) && !b.isNumericLiteral(property.value)),
      );
    }
    return true;
  });
  if (hasDynamicProperties) {
    const attributesUsed = attributePlan.entries.some((entry) => entry.type === 'spread');
    const canonicalName = (name: string) =>
      name === 'className' ? 'class' : name === 'onInput' ? 'onChange' : name;
    const entries = attributePlan.entries.map((entry) => {
      if (entry.type === 'spread') {
        instrumentSpreadEvents(entry.value, options);
        return { ...entry, value: b.callExpression(options.attributes, [entry.value]) };
      }
      const name = canonicalName(entry.name);
      if (
        name !== 'ref' &&
        name !== 'key' &&
        !capability.attributes.includes(name) &&
        !Object.hasOwn(desktopEventNames, entry.name)
      ) {
        fail(`desktop attribute ${name} is not implemented`, opening);
      }
      if (entry.event) {
        instrumentPropertyEvent(entry.name, entry.value, tag, capability.events, options);
      }
      return {
        ...entry,
        name,
        value: name === 'ref' ? stableRef(entry.value) : entry.value,
      };
    });
    const sites = reserveDesktopEvents(node, capability.events, destinations, instrument);
    const value = emitOrderedAttributes({ ...attributePlan, entries });
    properties.push(
      b.objectExpression([
        b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
        // Spread objects can be mutated through aliases and opaque callbacks.
        // Pull their fields whenever this lexical owner is invalidated.
        b.objectProperty(b.identifier('sources'), b.nullLiteral()),
        b.objectProperty(b.identifier('events'), valueExpression(sites)),
        b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], value)),
      ]),
    );
    return { attributes, style, attributesUsed };
  }
  for (const [index, entry] of attributePlan.entries.entries()) {
    const attribute = opening.attributes[index]!;
    if (
      entry.type === 'spread' ||
      !b.isJSXAttribute(attribute) ||
      !b.isJSXIdentifier(attribute.name)
    )
      fail('namespaced attributes are not supported', attribute);
    const name = entry.name === 'className' ? 'class' : entry.name;
    if (seen.has(name)) fail(`duplicate ${name} attribute`, attribute);
    seen.add(name);
    if (name === 'ref') {
      if (!attribute.value || !b.isJSXExpressionContainer(attribute.value))
        fail('ref requires a callback or assignable target', attribute);
      refs.push(
        b.objectExpression([
          b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
          b.objectProperty(
            b.identifier('value'),
            options.refValue(unwrapTypeExpression(entry.value) as t.Expression),
          ),
        ]),
      );
      continue;
    }
    if (!Object.hasOwn(desktopEventNames, name)) {
      if (!capability.attributes.includes(name))
        fail(`desktop attribute ${name} is not implemented`, attribute);
      const literal = unwrapTypeExpression(entry.value);
      if (
        tag === 'input' &&
        name === 'value' &&
        literal &&
        attribute.value &&
        b.isJSXExpressionContainer(attribute.value)
      ) {
        options.addValue(literal as t.Expression, node);
        continue;
      }
      if (name === 'style' && literal && b.isObjectExpression(literal)) {
        for (const property of literal.properties) {
          if (
            !b.isObjectProperty(property) ||
            property.computed ||
            (!b.isIdentifier(property.key) && !b.isStringLiteral(property.key))
          )
            fail('style objects require static named properties', property);
          const key = normalizeCssPropertyName(
            b.isIdentifier(property.key) ? property.key.name : property.key.value,
          );
          const value = unwrapTypeExpression(property.value);
          if (!b.isStringLiteral(value) && !b.isNumericLiteral(value))
            fail('style objects currently require static values', property);
          const unitless = [
            'opacity',
            'line-height',
            'font-weight',
            'flex-grow',
            'flex-shrink',
          ].includes(key);
          style.push({
            property: key,
            value:
              b.isNumericLiteral(value) && !unitless && value.value !== 0
                ? `${value.value}px`
                : String(value.value),
          });
        }
        continue;
      }
      if (!literal || !b.isStringLiteral(literal))
        fail(`${name} currently requires a static string`, attribute);
      if (name === 'style') style.push(...desktopInlineDeclarations(literal.value));
      else attributes[name] = literal.value;
      continue;
    }
    const value = attribute.value;
    if (!value || !b.isJSXExpressionContainer(value)) {
      fail(`${name} requires a callback expression`, attribute);
    }
    lowerDesktopEvent(
      name,
      unwrapTypeExpression(entry.value) as t.Expression,
      node,
      tag,
      capability.events,
      eventTypes,
      destinations,
      options,
      attribute,
    );
  }
  return { attributes, style, attributesUsed: false };
}

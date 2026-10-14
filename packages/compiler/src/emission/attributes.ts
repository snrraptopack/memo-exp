import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, isValidIdentifier } from '../ast';
import { staticAttributePropertyName, type OrderedAttributePlan } from '../jsx/attributes';

/**
 * Transform proven data-property values without flattening object spreads.
 * Both targets supply their existing prop/slot emitters. Computed properties,
 * accessors and opaque spread expressions keep their authored evaluation shape.
 */
export function mapStaticAttributeValues<T extends t.Expression>(
  expression: T,
  mapValue: (name: string, value: t.Expression) => t.Expression,
  unproven?: (property: t.Node) => void,
): T {
  if (!astFactory.isObjectExpression(expression)) {
    return expression;
  }

  return {
    ...expression,
    properties: expression.properties.map(property => {
      if (astFactory.isSpreadElement(property)) {
        return {
          ...property,
          argument: mapStaticAttributeValues(property.argument, mapValue, unproven),
        };
      }

      const name = staticAttributePropertyName(property);

      if (name === null || !astFactory.isObjectProperty(property) || !astFactory.isExpression(property.value)) {
        unproven?.(property);
        return property;
      }

      return { ...property, value: mapValue(name, property.value) };
    }),
  } as T;
}

/** DOM props and component ABI objects consume the same ordered semantic plan. */
export function emitOrderedAttributes(plan: OrderedAttributePlan, options: {
  eventValue?: (name: string, value: t.Expression) => t.Expression;
  attributeValue?: (name: string, value: t.Expression) => t.Expression;
} = {}): t.ObjectExpression {
  const properties: Array<t.ObjectProperty | t.SpreadElement> = [];
  for (const entry of plan.entries) {
    if (entry.type === 'spread') {
      properties.push(astFactory.spreadElement(cloneNode(entry.value)));
      continue;
    }
    const { name } = entry;
    const source = cloneNode(entry.value);
    const value = options.attributeValue?.(name, source) ?? source;
    const result = entry.event ? options.eventValue?.(name, value) ?? value : value;
    properties.push(astFactory.objectProperty(
      isValidIdentifier(name) ? astFactory.identifier(name) : astFactory.stringLiteral(name),
      result, false, astFactory.isIdentifier(result) && result.name === name,
    ));
  }
  return astFactory.objectExpression(properties);
}

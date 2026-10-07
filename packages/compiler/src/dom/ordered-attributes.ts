import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, isValidIdentifier } from '../ast';
import type { OrderedAttributePlan } from '../jsx/attributes';

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

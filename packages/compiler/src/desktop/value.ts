/** Encode static scene metadata without depending on JSX lowering. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';

export function valueExpression(value: unknown): t.Expression {
  if (Array.isArray(value)) return b.arrayExpression(value.map(valueExpression));
  if (value !== null && typeof value === 'object')
    return b.objectExpression(
      Object.entries(value).map(([key, item]) =>
        b.objectProperty(
          /^[A-Za-z_$][\w$]*$/.test(key) ? b.identifier(key) : b.stringLiteral(key),
          valueExpression(item),
        ),
      ),
    );
  if (value === null) return b.nullLiteral();
  if (typeof value === 'string') return b.stringLiteral(value);
  if (typeof value === 'number') return b.numericLiteral(value);
  if (typeof value === 'boolean') return b.booleanLiteral(value);
  throw new TypeError('Invalid desktop template value');
}

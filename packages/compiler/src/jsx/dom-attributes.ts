/**
 * Compile-time specialization for explicit JSX host attributes.
 *
 * Spreads still use the generic runtime dispatcher because their keys are
 * dynamic. Explicit HTML properties and mapped attributes can instead become
 * direct DOM operations, avoiding unrelated runtime style/SVG machinery.
 */

import * as t from '@babel/types';

const DOM_PROPERTY_ATTRIBUTES = new Set([
  'innerHTML',
  'checked',
  'value',
  'selected',
  'disabled',
  'hidden',
  'multiple',
  'required',
  'readOnly',
  'muted',
  'open',
  'controls',
  'loop',
  'autoFocus',
  'autoPlay',
  'tabIndex',
]);

const DOM_ATTRIBUTE_NAMES: Record<string, string> = {
  htmlFor: 'for',
  crossOrigin: 'crossorigin',
};

export function domPropertyName(
  name: string,
  elementIsSvg: boolean,
): string | null {
  return !elementIsSvg && DOM_PROPERTY_ATTRIBUTES.has(name) ? name : null;
}

export function isMappedDomAttribute(
  name: string,
  elementIsSvg: boolean,
): boolean {
  return !elementIsSvg && name in DOM_ATTRIBUTE_NAMES;
}

export function domPropertyWrite(
  varName: string,
  name: string,
  value: t.Expression,
): t.Statement {
  const element = t.identifier(varName);
  if (name === 'tabIndex') {
    if (t.isStringLiteral(value)) {
      return t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(element, t.identifier(name)),
          t.cloneNode(value),
        ),
      );
    }
    return t.expressionStatement(
      t.conditionalExpression(
        t.binaryExpression('==', t.cloneNode(value), t.nullLiteral()),
        t.callExpression(
          t.memberExpression(
            t.cloneNode(element),
            t.identifier('removeAttribute'),
          ),
          [t.stringLiteral('tabindex')],
        ),
        t.assignmentExpression(
          '=',
          t.memberExpression(t.cloneNode(element), t.identifier(name)),
          t.cloneNode(value),
        ),
      ),
    );
  }

  const empty =
    name === 'value' || name === 'innerHTML'
      ? t.stringLiteral('')
      : t.booleanLiteral(false);
  const assigned = t.isStringLiteral(value)
    ? t.cloneNode(value)
    : t.conditionalExpression(
        t.binaryExpression('==', t.cloneNode(value), t.nullLiteral()),
        empty,
        t.cloneNode(value),
      );
  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(element, t.identifier(name)),
      assigned,
    ),
  );
}

export function domAttributeWrite(
  varName: string,
  name: string,
  value: t.Expression,
): t.Statement {
  const element = t.identifier(varName);
  const attribute = DOM_ATTRIBUTE_NAMES[name] ?? name;
  if (t.isStringLiteral(value)) {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(element, t.identifier('setAttribute')),
        [t.stringLiteral(attribute), t.cloneNode(value)],
      ),
    );
  }

  return t.expressionStatement(
    t.conditionalExpression(
      t.logicalExpression(
        '||',
        t.binaryExpression('==', t.cloneNode(value), t.nullLiteral()),
        t.binaryExpression('===', t.cloneNode(value), t.booleanLiteral(false)),
      ),
      t.callExpression(
        t.memberExpression(
          t.cloneNode(element),
          t.identifier('removeAttribute'),
        ),
        [t.stringLiteral(attribute)],
      ),
      t.callExpression(
        t.memberExpression(element, t.identifier('setAttribute')),
        [
          t.stringLiteral(attribute),
          t.conditionalExpression(
            t.binaryExpression(
              '===',
              t.cloneNode(value),
              t.booleanLiteral(true),
            ),
            t.stringLiteral(''),
            t.callExpression(t.identifier('String'), [t.cloneNode(value)]),
          ),
        ],
      ),
    ),
  );
}

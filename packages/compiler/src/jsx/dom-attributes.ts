/**
 * Compile-time specialization for explicit JSX host attributes.
 *
 * Spreads still use the generic runtime dispatcher because their keys are
 * dynamic. Explicit HTML properties and mapped attributes can instead become
 * direct DOM operations, avoiding unrelated runtime style/SVG machinery.
 */

import * as t from '@babel/types';
import { cloneNode as cloneEstreeNode } from '../ast';

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
          cloneEstreeNode(value),
        ),
      );
    }
    return t.expressionStatement(
      t.conditionalExpression(
        t.binaryExpression('==', cloneEstreeNode(value), t.nullLiteral()),
        t.callExpression(
          t.memberExpression(
            cloneEstreeNode(element),
            t.identifier('removeAttribute'),
          ),
          [t.stringLiteral('tabindex')],
        ),
        t.assignmentExpression(
          '=',
          t.memberExpression(cloneEstreeNode(element), t.identifier(name)),
          cloneEstreeNode(value),
        ),
      ),
    );
  }

  const empty =
    name === 'value' || name === 'innerHTML'
      ? t.stringLiteral('')
      : t.booleanLiteral(false);
  const assigned = t.isStringLiteral(value)
    ? cloneEstreeNode(value)
    : t.conditionalExpression(
        t.binaryExpression('==', cloneEstreeNode(value), t.nullLiteral()),
        empty,
        cloneEstreeNode(value),
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
        [t.stringLiteral(attribute), cloneEstreeNode(value)],
      ),
    );
  }

  return t.expressionStatement(
    t.conditionalExpression(
      t.logicalExpression(
        '||',
        t.binaryExpression('==', cloneEstreeNode(value), t.nullLiteral()),
        t.binaryExpression('===', cloneEstreeNode(value), t.booleanLiteral(false)),
      ),
      t.callExpression(
        t.memberExpression(
          cloneEstreeNode(element),
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
              cloneEstreeNode(value),
              t.booleanLiteral(true),
            ),
            t.stringLiteral(''),
            t.callExpression(t.identifier('String'), [cloneEstreeNode(value)]),
          ),
        ],
      ),
    ),
  );
}

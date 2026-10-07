/**
 * Compile-time specialization for explicit JSX host attributes.
 *
 * Spreads still use the generic runtime dispatcher because their keys are
 * dynamic. Explicit HTML properties and mapped attributes can instead become
 * direct DOM operations, avoiding unrelated runtime style/SVG machinery.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
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
  contentEditable: 'contenteditable',
  spellCheck: 'spellcheck',
  autoCapitalize: 'autocapitalize',
};

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

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

function isAriaAttribute(name: string): boolean {
  return name.toLowerCase().startsWith('aria-');
}

export function domPropertyWrite(
  varName: string,
  name: string,
  value: t.Expression,
): t.Statement {
  const element = astFactory.identifier(varName);
  if (name === 'tabIndex') {
    if (astFactory.isStringLiteral(value)) {
      return astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.memberExpression(element, astFactory.identifier(name)),
          cloneEstreeNode(value),
        ),
      );
    }
    return astFactory.expressionStatement(
      astFactory.conditionalExpression(
        astFactory.binaryExpression('==', cloneEstreeNode(value), astFactory.nullLiteral()),
        astFactory.callExpression(
          astFactory.memberExpression(
            cloneEstreeNode(element),
            astFactory.identifier('removeAttribute'),
          ),
          [astFactory.stringLiteral('tabindex')],
        ),
        astFactory.assignmentExpression(
          '=',
          astFactory.memberExpression(cloneEstreeNode(element), astFactory.identifier(name)),
          cloneEstreeNode(value),
        ),
      ),
    );
  }

  const empty =
    name === 'value' || name === 'innerHTML'
      ? astFactory.stringLiteral('')
      : astFactory.booleanLiteral(false);
  const assigned = astFactory.isStringLiteral(value)
    ? cloneEstreeNode(value)
    : astFactory.conditionalExpression(
        astFactory.binaryExpression('==', cloneEstreeNode(value), astFactory.nullLiteral()),
        empty,
        cloneEstreeNode(value),
      );
  return astFactory.expressionStatement(
    astFactory.assignmentExpression(
      '=',
      astFactory.memberExpression(element, astFactory.identifier(name)),
      assigned,
    ),
  );
}

export function domAttributeWrite(
  varName: string,
  name: string,
  value: t.Expression,
): t.Statement {
  const element = astFactory.identifier(varName);
  const attribute = DOM_ATTRIBUTE_NAMES[name] ?? name;
  const trueValue = BOOLEAN_ATTRIBUTES.has(attribute.toLowerCase()) ? '' : 'true';
  if (astFactory.isStringLiteral(value)) {
    return astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(element, astFactory.identifier('setAttribute')),
        [astFactory.stringLiteral(attribute), cloneEstreeNode(value)],
      ),
    );
  }

  const removeCondition = isAriaAttribute(attribute)
    ? astFactory.binaryExpression('==', cloneEstreeNode(value), astFactory.nullLiteral())
    : astFactory.logicalExpression(
        '||',
        astFactory.binaryExpression('==', cloneEstreeNode(value), astFactory.nullLiteral()),
        astFactory.binaryExpression(
          '===',
          cloneEstreeNode(value),
          astFactory.booleanLiteral(false),
        ),
      );

  return astFactory.expressionStatement(
    astFactory.conditionalExpression(
      removeCondition,
      astFactory.callExpression(
        astFactory.memberExpression(
          cloneEstreeNode(element),
          astFactory.identifier('removeAttribute'),
        ),
        [astFactory.stringLiteral(attribute)],
      ),
      astFactory.callExpression(
        astFactory.memberExpression(element, astFactory.identifier('setAttribute')),
        [
          astFactory.stringLiteral(attribute),
          astFactory.conditionalExpression(
            astFactory.binaryExpression(
              '===',
              cloneEstreeNode(value),
              astFactory.booleanLiteral(true),
            ),
            astFactory.stringLiteral(trueValue),
            astFactory.callExpression(astFactory.identifier('String'), [cloneEstreeNode(value)]),
          ),
        ],
      ),
    ),
  );
}

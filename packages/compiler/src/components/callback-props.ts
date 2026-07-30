/**
 * Stable scalar callback props.
 *
 * Inline callback expressions are factory values, not reactive values. Their
 * closures observe the component's live bindings, so recreating them in every
 * prop replay only causes identity churn and needless child invalidation.
 */

import * as t from '@babel/types';
import type { Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import type { EmitScope } from '../emission/scope';

export function isInlineScalarCallback(
  value: t.Expression,
): value is t.ArrowFunctionExpression | t.FunctionExpression {
  return (
    (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) &&
    !containsJsx(value.body)
  );
}

export function stabilizeInlineCallbackProp(
  ctx: Ctx,
  scope: EmitScope,
  value: t.ArrowFunctionExpression | t.FunctionExpression,
  hint = 'callback',
): t.Identifier {
  const callback = generatedIdentifier(ctx, hint);
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.cloneNode(callback), t.cloneNode(value, true)),
    ]),
  );
  return callback;
}

export function stabilizeInlineCallbackStatement(
  ctx: Ctx,
  statements: t.Statement[],
  value: t.ArrowFunctionExpression | t.FunctionExpression,
  hint = 'callback',
): t.Identifier {
  const callback = generatedIdentifier(ctx, hint);
  statements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.cloneNode(callback), t.cloneNode(value, true)),
    ]),
  );
  return callback;
}

function containsJsx(node: t.Node): boolean {
  let found = false;
  t.traverseFast(node, (child) => {
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      found = true;
      return t.traverseFast.stop;
    }
  });
  return found;
}

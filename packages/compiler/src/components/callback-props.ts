/**
 * Stable scalar callback props.
 *
 * Inline callback expressions are factory values, not reactive values. Their
 * closures observe the component's live bindings, so recreating them in every
 * prop replay only causes identity churn and needless child invalidation.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { walkAst } from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import type { EmitScope } from '../emission/scope';

export function isInlineScalarCallback(
  value: t.Expression,
): value is t.ArrowFunctionExpression | t.FunctionExpression {
  return (
    (astFactory.isArrowFunctionExpression(value) || astFactory.isFunctionExpression(value)) &&
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
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(cloneEstreeNode(callback), cloneEstreeNode(value, true)),
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
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(cloneEstreeNode(callback), cloneEstreeNode(value, true)),
    ]),
  );
  return callback;
}

function containsJsx(node: t.Node): boolean {
  let found = false;
  walkAst(node, {
    enter(child) {
      if (found) return false;
      if (astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)) {
        found = true;
        return false;
      }
    },
  });
  return found;
}

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import { freshSlot, type EmitScope } from './scope';

/** Cache only primitive joins; operand reads and opaque coercions still replay. */
export function cachedTextConcat(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.Expression,
): ((write: (expression: t.Expression) => t.Statement, initialize?: boolean) => t.Statement) | null {
  if (expression.type !== 'BinaryExpression' || expression.operator !== '+' ||
      expression.left.type !== 'BinaryExpression' || expression.left.operator !== '+' ||
      !astFactory.isStringLiteral(expression.left.right)) return null;
  const left = expression.left.left;
  const separator = expression.left.right;
  const right = expression.right;
  const previousLeft = freshSlot(ctx, scope);
  const previousRight = freshSlot(ctx, scope);
  const valid = freshSlot(ctx, scope);
  const currentLeft = generatedIdentifier(ctx, 'textLeft');
  const currentRight = generatedIdentifier(ctx, 'textRight');
  const id = (name: string) => astFactory.identifier(name);
  const primitive = (value: t.Identifier): t.Expression => astFactory.logicalExpression('||',
    astFactory.binaryExpression('===', astFactory.unaryExpression('typeof', cloneNode(value)), astFactory.stringLiteral('number')),
    astFactory.binaryExpression('===', astFactory.unaryExpression('typeof', cloneNode(value)), astFactory.stringLiteral('string')),
  );
  const joined = (last: t.Expression) => astFactory.binaryExpression('+',
    astFactory.binaryExpression('+', cloneNode(currentLeft), cloneNode(separator)), last);
  const assign = (name: string, value: t.Expression) => astFactory.expressionStatement(
    astFactory.assignmentExpression('=', id(name), value));
  const fallback = (write: (expression: t.Expression) => t.Statement, last: t.Expression): t.Statement => ({
    type: 'TryStatement',
    block: astFactory.blockStatement([write(joined(last))]),
    handler: null,
    // Coercion may reenter this updater and seed the primitive cache. The
    // outer result then supersedes that text; invalidate even if it throws.
    finalizer: astFactory.blockStatement([assign(valid, astFactory.booleanLiteral(false))]),
  });
  return (write, initialize = false) => {
    const commit = astFactory.blockStatement([
      assign(previousLeft, cloneNode(currentLeft)),
      assign(previousRight, cloneNode(currentRight)),
      assign(valid, astFactory.booleanLiteral(true)),
      write(joined(cloneNode(currentRight))),
    ]);
    return astFactory.blockStatement([
      astFactory.variableDeclaration('const', [astFactory.variableDeclarator(cloneNode(currentLeft), cloneNode(left))]),
      astFactory.ifStatement(primitive(currentLeft), astFactory.blockStatement([
        astFactory.variableDeclaration('const', [astFactory.variableDeclarator(cloneNode(currentRight), cloneNode(right))]),
        astFactory.ifStatement(primitive(currentRight), astFactory.blockStatement([
          initialize ? commit : astFactory.ifStatement(astFactory.logicalExpression('||',
            astFactory.unaryExpression('!', id(valid)),
            astFactory.logicalExpression('||',
              astFactory.binaryExpression('!==', id(previousLeft), cloneNode(currentLeft)),
              astFactory.binaryExpression('!==', id(previousRight), cloneNode(currentRight)),
            ),
          ), commit),
        ]), fallback(write, cloneNode(currentRight))),
      ]),
      // A nonprimitive left operand must coerce before the right operand is
      // evaluated, exactly as in the original left-associative expression.
      fallback(write, cloneNode(right))),
    ]);
  };
}

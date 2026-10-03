import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import { freshSlot, type EmitScope } from './scope';

/** Read every input, but normalize an unchanged primitive only once. */
export function cachedTextValue(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.Expression,
): (write: (value: t.Expression) => t.Statement, initialize?: boolean) => t.Statement {
  const previous = freshSlot(ctx, scope);
  const current = generatedIdentifier(ctx, 'textValue');
  const previousId = () => astFactory.identifier(previous);
  const currentId = () => cloneNode(current);
  const assign = (value: t.Expression) => astFactory.expressionStatement(
    astFactory.assignmentExpression('=', previousId(), value),
  );
  // NaN cannot match any input, including itself. Opaque conversions may
  // reenter and seed a primitive cache; invalidate after success or failure.
  const invalidate = () => assign(astFactory.binaryExpression('/', astFactory.numericLiteral(0), astFactory.numericLiteral(0)));
  const primitive = astFactory.logicalExpression('||',
    astFactory.binaryExpression('===', currentId(), astFactory.nullLiteral()),
    astFactory.logicalExpression('&&',
      astFactory.binaryExpression('!==', astFactory.unaryExpression('typeof', currentId()), astFactory.stringLiteral('object')),
      astFactory.binaryExpression('!==', astFactory.unaryExpression('typeof', currentId()), astFactory.stringLiteral('function')),
    ),
  );
  return (write, initialize = false) => {
    const commit = astFactory.blockStatement([
      {
        type: 'TryStatement',
        block: astFactory.blockStatement([write(currentId())]),
        handler: null,
        finalizer: astFactory.blockStatement([invalidate()]),
      },
      astFactory.ifStatement(cloneNode(primitive), assign(currentId())),
    ]);
    return astFactory.blockStatement([
      astFactory.variableDeclaration('const', [astFactory.variableDeclarator(currentId(), cloneNode(expression))]),
      initialize ? commit : astFactory.ifStatement(
        astFactory.binaryExpression('!==', previousId(), currentId()), commit,
      ),
    ]);
  };
}

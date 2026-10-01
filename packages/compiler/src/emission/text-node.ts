import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import {
  freshSlot,
  pushSlotUpdater,
  renderDocument,
  slotGuard,
  type EmitScope,
} from './scope';
import {
  preparationRead,
  registerTransparentDataSite,
  transparentExpressionSources,
} from '../data-sources';
import { cachedTextConcat } from './text-concat';

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

export function emitText(
  ctx: Ctx,
  scope: EmitScope,
  expr: t.Expression,
  ownerId: t.Expression,
): string {
  const varName = generatedIdentifier(ctx, `text${scope.textCounter++}`).name;
  if (astFactory.isStringLiteral(expr)) {
    // static text: no slot, content baked into the node
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(varName),
          astFactory.callExpression(
            astFactory.memberExpression(
              renderDocument(ctx, scope),
              astFactory.identifier('createTextNode'),
            ),
            [astFactory.stringLiteral(expr.value)],
          ),
        ),
      ]),
    );
    return varName;
  }
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(varName),
        astFactory.callExpression(
          astFactory.memberExpression(
            renderDocument(ctx, scope),
            astFactory.identifier('createTextNode'),
          ),
          [astFactory.stringLiteral('')],
        ),
      ),
    ]),
  );
  const prepared = preparationRead(ctx, scope, ownerId, cloneEstreeNode(expr));
  if (!scope.cacheText) {
    const setter = (): t.Statement =>
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'setTextData'), [
          astFactory.identifier(varName),
          cloneEstreeNode(prepared),
        ]),
      );
    scope.creation.push(setter());
    registerTransparentDataSite(
      ctx, scope, transparentExpressionSources(ctx, expr), ownerId, setter(),
    );
    pushSlotUpdater(scope, setter, expr);
    return varName;
  }
  const slot = freshSlot(ctx, scope);
  const concat = cachedTextConcat(ctx, scope, prepared);
  const seed = (expression: t.Expression): t.Statement => astFactory.expressionStatement(
    astFactory.assignmentExpression('=', astFactory.identifier(slot),
      astFactory.callExpression(md(ctx, 'textValue'), [expression])),
  );
  scope.creation.push(
    concat ? concat(seed, true) : seed(cloneEstreeNode(prepared)),
    // Keep the seed recognizable to markup extraction, including hydration.
    astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'setTextData'), [
        astFactory.identifier(varName),
        astFactory.identifier(slot),
      ]),
    ),
  );
  const write = (expression: t.Expression): t.Statement =>
    slotGuard(scope, slot, astFactory.callExpression(md(ctx, 'textValue'), [expression]), (value) =>
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.memberExpression(
            astFactory.identifier(varName),
            astFactory.identifier('data'),
          ),
          value,
        ),
      ),
    );
  const updater = () => concat ? concat(write) : write(cloneEstreeNode(prepared));
  registerTransparentDataSite(
    ctx,
    scope,
    transparentExpressionSources(ctx, expr),
    ownerId,
    updater(),
  );
  pushSlotUpdater(scope, updater, expr);
  return varName;
}

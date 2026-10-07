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
import { cachedTextValue } from './text-value';
import { initialNode, initialOrCreate, freshInitialStatement, type InitialDomPath } from './initial-dom';

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

export function emitText(
  ctx: Ctx,
  scope: EmitScope,
  expr: t.Expression,
  ownerId: t.Expression,
  initialPath?: InitialDomPath,
  initialStatic = false,
  initialEmpty = false,
): string {
  const varName = generatedIdentifier(ctx, `text${scope.textCounter++}`).name;
  const adopting=scope.initialDom?.adopting;
  if (initialStatic && !adopting) {
    // The descriptor adopts an empty placeholder even when no updater needs
    // to retain its text node afterward.
    if (initialEmpty) initialNode(scope, initialPath!, '#text');
    return varName;
  }
  if (astFactory.isStringLiteral(expr) || initialStatic) {
    if (scope.initialDom && !adopting) return varName;
    if (initialEmpty) initialNode(scope,initialPath!,'#text');
    // static text: no slot, content baked into the node
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(varName),
          initialOrCreate(scope,astFactory.identifier('undefined'),astFactory.callExpression(
            astFactory.memberExpression(
              renderDocument(ctx, scope),
              astFactory.identifier('createTextNode'),
            ),
            [astFactory.isStringLiteral(expr) ? astFactory.stringLiteral(expr.value) : astFactory.callExpression(md(ctx,'textValue'),[cloneEstreeNode(expr)])],
          )),
        ),
      ]),
    );
    return varName;
  }
  if (scope.initialDom && !initialPath) throw new Error('memo-dom: initial text has no binding address');
  const bound = initialPath ? initialNode(scope,initialPath,'#text') : undefined;
  const created = bound && !adopting ? bound : astFactory.callExpression(
    astFactory.memberExpression(renderDocument(ctx,scope),astFactory.identifier('createTextNode')),[astFactory.stringLiteral('')]);
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(varName),
        bound ? initialOrCreate(scope,bound,created) : created,
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
    if (!initialPath || adopting) scope.creation.push(freshInitialStatement(scope,setter()));
    registerTransparentDataSite(
      ctx, scope, transparentExpressionSources(expr), ownerId, setter(),
    );
    pushSlotUpdater(scope, setter, expr);
    return varName;
  }
  const slot = freshSlot(ctx, scope);
  const concat = cachedTextConcat(ctx, scope, prepared);
  const value = concat ?? cachedTextValue(ctx, scope, prepared);
  const seed = (expression: t.Expression): t.Statement => astFactory.expressionStatement(
    astFactory.assignmentExpression('=', astFactory.identifier(slot),
      astFactory.callExpression(md(ctx, 'textValue'), [expression])),
  );
  const freshSeed = astFactory.blockStatement([
    value(seed, true),
    // Keep the seed recognizable to markup extraction, including hydration.
    astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'setTextData'), [
        astFactory.identifier(varName),
        astFactory.identifier(slot),
      ]),
    ),
  ]);
  if (initialPath) {
    const adoptedSeed=astFactory.expressionStatement(astFactory.assignmentExpression('=',
      astFactory.identifier(slot),astFactory.memberExpression(astFactory.identifier(varName),astFactory.identifier('data'))));
    scope.creation.push(adopting ? astFactory.ifStatement(adopting,adoptedSeed,freshSeed) : adoptedSeed);
  } else scope.creation.push(...freshSeed.body);
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
  const updater = () => value(write);
  registerTransparentDataSite(
    ctx,
    scope,
    transparentExpressionSources(expr),
    ownerId,
    updater(),
  );
  pushSlotUpdater(scope, updater, expr);
  return varName;
}

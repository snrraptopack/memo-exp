import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import {
  pushSlotUpdater,
  renderDocument,
  type EmitScope,
} from './scope';
import {
  registerTransparentDataSite,
  transparentExpressionSources,
} from '../data-sources';

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

/**
 * Dynamic text write: `_MD.setTextData(node, expr)` — the runtime helper
 * guards on the node's current data so no per-slot local is needed, and the
 * same call seeds the freshly-created node and runs inside update closures.
 */
function textSetter(
  ctx: Ctx,
  varName: string,
  expr: t.Expression,
): () => t.Statement {
  return () =>
    astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'setTextData'), [
        astFactory.identifier(varName),
        cloneEstreeNode(expr),
      ]),
    );
}

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
  const setter = textSetter(ctx, varName, expr);
  scope.creation.push(setter()); // R4: creation seeds through the same guarded setter
  registerTransparentDataSite(
    ctx,
    scope,
    transparentExpressionSources(ctx, expr),
    ownerId,
    setter(),
  );
  pushSlotUpdater(scope, setter, expr);
  return varName;
}

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import {
  freshSlot,
  pushSlotUpdater,
  renderDocument,
  slotGuard,
  type EmitScope,
} from './scope';
import {
  registerTransparentDataSite,
  transparentExpressionSources,
} from '../data-sources';

// ---------------------------------------------------------------------
// shared statement builders
// ---------------------------------------------------------------------

/**
 * M5.9: dynamic slots are per-scope LOCALS (`let $s0, $s1, …`), not a cache
 * object with string keys — the update closure guards inline
 * (`if ($s0 !== ($t = expr)) { $s0 = $t; …write… }`), which keeps the whole
 * row update in one inlinable function instead of N calls × string lookups.
 */
/**
 * The inline guarded write shared by every dynamic slot:
 * `if ($sK !== ($t = EXPR)) { $sK = $t; WRITE($t) }` — used for BOTH the
 * creation and the update branch: a fresh slot (undefined) never equals a
 * legit first value except undefined/null/boolean, and for those the
 * freshly-created DOM node already holds exactly what the write would set
 * (empty text data, empty className, absent attribute).
 */
/** The value-normalization shared by text semantics: null/undefined/bool → ''. */
function textValue(tmp: t.Identifier): t.Expression {
  return astFactory.conditionalExpression(
    astFactory.logicalExpression(
      '||',
      astFactory.binaryExpression('==', cloneEstreeNode(tmp), astFactory.nullLiteral()),
      astFactory.binaryExpression(
        '===',
        astFactory.unaryExpression('typeof', cloneEstreeNode(tmp), true),
        astFactory.stringLiteral('boolean'),
      ),
    ),
    astFactory.stringLiteral(''),
    astFactory.callExpression(astFactory.identifier('String'), [cloneEstreeNode(tmp)]),
  );
}

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

/** M5.9: inline text write — if ($sK !== ($t = expr)) { $sK = $t; node.data = … } */
function textSetter(
  scope: EmitScope,
  key: string,
  varName: string,
  expr: t.Expression,
): () => t.Statement {
  return () =>
    slotGuard(scope, key, cloneEstreeNode(expr), (tmp) =>
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.memberExpression(astFactory.identifier(varName), astFactory.identifier('data')),
          textValue(tmp),
        ),
      ),
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
  const key = freshSlot(ctx, scope);
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
  const setter = textSetter(scope, key, varName, expr);
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

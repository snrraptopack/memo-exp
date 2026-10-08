import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type ComponentPath } from '../context';
import type { RowCtx } from './row-context';
import { type DomContext as Ctx } from './context';
import { componentId, generatedIdentifier, md } from './identifiers';
import { cacheDecl, newEmitScope, registerStmt, updateDecl, type EmitScope } from './scope';
import type { NodeEmitter } from './node-emitter';
import { applyRepeatedDomTemplate } from './dom-template';
import type { RenderCallbackPlan } from '../components/render-callbacks';

/**
 * Compile one caller-authored render callback into a row-factory adapter.
 *
 * The adapter is plain generated JavaScript, not a runtime JSX value. Its
 * live row update closures remain indexed by the lexical caller so caller
 * state can update rows mounted inside another component's list.
 */
export function buildRenderCallbackAdapter(
  ctx: Ctx,
  ownerScope: EmitScope,
  plan: RenderCallbackPlan,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  const {itemParam,indexParam}=plan;
  const itemPattern=cloneEstreeNode(plan.itemPattern);
  const jsx=cloneEstreeNode(plan.jsx);
  const keyExpression=plan.keyExpression===null?null:cloneEstreeNode(plan.keyExpression);

  const adapter = generatedIdentifier(ctx, 'renderCallback');
  const liveRows = generatedIdentifier(ctx, 'renderRows');
  const nextUpdate = generatedIdentifier(ctx, 'renderNextUpdate');
  const rowId = generatedIdentifier(ctx, 'renderRowId');
  const refreshRow = generatedIdentifier(ctx, 'refreshRenderRow');
  const nextItem = generatedIdentifier(ctx, 'renderNextItem');
  const nextIndex =
    indexParam === null ? null : generatedIdentifier(ctx, 'renderNextIndex');
  const rowScope = newEmitScope(ctx, false, ownerScope);
  const rowContext: RowCtx = {
    itemParam,
    itemPath: [],
    rowIdVar: rowId.name,
    keyPath: plan.keyPath===null?null:[...plan.keyPath],
    sourceKey: '$render-callback',
    sourceLocal: true,
    ownerIdVar: astFactory.isIdentifier(ownerId)
      ? ownerId.name
      : componentId(ctx, componentName).name,
  };
  const root = emitNode(
    ctx,
    rowScope,
    jsx,
    componentName,
    componentPath,
    'row',
    rowContext,
    rowId,
    inSvg,
    rowId,
  );
  applyRepeatedDomTemplate(ctx, rowScope, root);

  ownerScope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(liveRows),
        astFactory.newExpression(astFactory.identifier('Set'), []),
      ),
    ]),
  );
  ownerScope.updaters.push(() =>
    astFactory.forOfStatement(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(cloneEstreeNode(nextUpdate)),
      ]),
      cloneEstreeNode(liveRows),
      astFactory.expressionStatement(
        astFactory.callExpression(cloneEstreeNode(nextUpdate), []),
      ),
    ),
  );

  const bindingUpdates: t.Statement[] = [
    astFactory.expressionStatement(
      astFactory.assignmentExpression(
        '=',
        cloneEstreeNode(itemPattern, true),
        cloneEstreeNode(nextItem),
      ),
    ),
  ];
  if (nextIndex !== null && indexParam !== null) {
    bindingUpdates.push(
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(indexParam),
          cloneEstreeNode(nextIndex),
        ),
      ),
    );
  }

  const create = astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(itemPattern, true),
      cloneEstreeNode(rowId),
      ...(indexParam === null ? [] : [astFactory.identifier(indexParam)]),
    ],
    astFactory.blockStatement([
      cacheDecl(rowScope),
      updateDecl(ctx, rowScope),
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(refreshRow),
          astFactory.arrowFunctionExpression(
            [],
            astFactory.blockStatement([
              astFactory.expressionStatement(
                astFactory.callExpression(astFactory.identifier(rowScope.updateVar), []),
              ),
              astFactory.expressionStatement(
                astFactory.callExpression(md(ctx, 'renderDescendants'), [
                  cloneEstreeNode(rowId),
                ]),
              ),
            ]),
          ),
        ),
      ]),
      ...rowScope.prelude,
      registerStmt(
        ctx,
        cloneEstreeNode(rowId),
        cloneEstreeNode(ownerId, true),
        cloneEstreeNode(refreshRow),
      ),
      ...rowScope.creation,
      ...rowScope.mounts,
      astFactory.expressionStatement(
        astFactory.callExpression(
          astFactory.memberExpression(cloneEstreeNode(liveRows), astFactory.identifier('add')),
          [cloneEstreeNode(refreshRow)],
        ),
      ),
      astFactory.returnStatement(
        astFactory.objectExpression([
          astFactory.objectProperty(
            astFactory.identifier('nodes'),
            astFactory.callExpression(md(ctx, 'rootNodes'), [astFactory.identifier(root)]),
          ),
          astFactory.objectProperty(
            astFactory.identifier('entities'),
            astFactory.arrayExpression([cloneEstreeNode(rowId)]),
          ),
          astFactory.objectProperty(
            astFactory.identifier('update'),
            astFactory.arrowFunctionExpression(
              [
                cloneEstreeNode(nextItem),
                ...(nextIndex === null ? [] : [cloneEstreeNode(nextIndex)]),
              ],
              astFactory.blockStatement([
                ...bindingUpdates,
                astFactory.ifStatement(
                  astFactory.unaryExpression('!', astFactory.callExpression(md(ctx, 'getEntity'), [cloneEstreeNode(rowId)])),
                  astFactory.returnStatement(null),
                ),
                astFactory.expressionStatement(astFactory.callExpression(cloneEstreeNode(refreshRow), [])),
              ]),
            ),
          ),
          astFactory.objectProperty(
            astFactory.identifier('dispose'),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.callExpression(
                astFactory.memberExpression(
                  cloneEstreeNode(liveRows),
                  astFactory.identifier('delete'),
                ),
                [cloneEstreeNode(refreshRow)],
              ),
            ),
          ),
        ]),
      ),
    ]),
  );
  const key =
    keyExpression === null
      ? astFactory.nullLiteral()
      : astFactory.arrowFunctionExpression(
          [
            cloneEstreeNode(itemPattern, true),
            ...(indexParam === null ? [] : [astFactory.identifier(indexParam)]),
          ],
          cloneEstreeNode(keyExpression),
        );

  ownerScope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(adapter),
        astFactory.objectExpression([
          astFactory.objectProperty(astFactory.identifier('create'), create),
          astFactory.objectProperty(astFactory.identifier('key'), key),
        ]),
      ),
    ]),
  );
  return adapter;
}

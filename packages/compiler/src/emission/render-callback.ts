import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  extractPatternIdentifiers,
  type BaseNode,
} from '../ast';
import { cloneRuntimeBindingPattern } from '../analysis/runtime-pattern';
import {
  attrExpr,
  keyPathOf,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import { componentId, generatedIdentifier, md } from '../identifiers';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
  type EmitScope,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import { applyRepeatedDomTemplate } from './dom-template';

function callbackJsx(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): t.JSXElement | null {
  if (astFactory.isJSXElement(callback.body)) return callback.body;
  if (
    astFactory.isBlockStatement(callback.body) &&
    callback.body.body.length === 1 &&
    astFactory.isReturnStatement(callback.body.body[0]) &&
    astFactory.isJSXElement(callback.body.body[0].argument)
  ) {
    return callback.body.body[0].argument;
  }
  return null;
}

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
  source: t.Expression,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  if (
    (!astFactory.isArrowFunctionExpression(source) &&
      !astFactory.isFunctionExpression(source)) ||
    source.async ||
    source.generator
  ) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: render callbacks must be synchronous inline arrows or function expressions',
    );
  }
  const jsx = callbackJsx(source);
  const first = source.params[0];
  const second = source.params[1];
  if (
    jsx === null ||
    source.params.length < 1 ||
    source.params.length > 2 ||
    (!astFactory.isIdentifier(first) &&
      !astFactory.isObjectPattern(first) &&
      !astFactory.isArrayPattern(first)) ||
    (second !== undefined && !astFactory.isIdentifier(second))
  ) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: render callbacks take an item binding pattern and optional index, then return one JSX element',
    );
  }

  const itemPattern = cloneRuntimeBindingPattern(first);
  const itemBindings = extractPatternIdentifiers(
    itemPattern as unknown as BaseNode,
  ).map((identifier) => identifier.name);
  if (itemBindings.length === 0) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: render callback item patterns must bind at least one name',
    );
  }
  const itemParam = astFactory.isIdentifier(itemPattern)
    ? itemPattern.name
    : itemBindings[0]!;
  const indexParam = second === undefined ? null : second.name;

  let keyExpression: t.Expression | null = null;
  jsx.openingElement.attributes = jsx.openingElement.attributes.filter(
    (attribute) => {
      if (
        astFactory.isJSXSpreadAttribute(attribute) ||
        !astFactory.isJSXIdentifier(attribute.name) ||
        attribute.name.name !== 'key'
      ) {
        return true;
      }
      keyExpression = attrExpr(attribute.value);
      if (keyExpression === null) {
        throw componentPath.buildCodeFrameError(
          'memo-dom: key={...} needs an expression',
        );
      }
      return false;
    },
  );

  const adapter = generatedIdentifier(ctx, 'renderCallback');
  const liveRows = generatedIdentifier(ctx, 'renderRows');
  const nextUpdate = generatedIdentifier(ctx, 'renderNextUpdate');
  const rowId = generatedIdentifier(ctx, 'renderRowId');
  const refreshRow = generatedIdentifier(ctx, 'refreshRenderRow');
  const nextItem = generatedIdentifier(ctx, 'renderNextItem');
  const nextIndex =
    indexParam === null ? null : generatedIdentifier(ctx, 'renderNextIndex');
  const rowScope = newEmitScope(ctx);
  const rowContext: RowCtx = {
    itemParam,
    itemPath: [],
    rowIdVar: rowId.name,
    keyPath: keyPathOf(keyExpression, itemParam),
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
      updateDecl(rowScope),
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
            astFactory.identifier('updateProps'),
            astFactory.arrowFunctionExpression(
              [
                cloneEstreeNode(nextItem),
                ...(nextIndex === null ? [] : [cloneEstreeNode(nextIndex)]),
              ],
              astFactory.blockStatement(bindingUpdates),
            ),
          ),
          astFactory.objectProperty(
            astFactory.identifier('update'),
            cloneEstreeNode(refreshRow),
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

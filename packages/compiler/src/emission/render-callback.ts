import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  attrExpr,
  keyPathOf,
  type Ctx,
  type RowCtx,
} from '../context';
import { generatedIdentifier, md } from '../identifiers';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
  type EmitScope,
} from './scope';
import type { NodeEmitter } from './node-emitter';

function callbackJsx(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): t.JSXElement | null {
  if (t.isJSXElement(callback.body)) return callback.body;
  if (
    t.isBlockStatement(callback.body) &&
    callback.body.body.length === 1 &&
    t.isReturnStatement(callback.body.body[0]) &&
    t.isJSXElement(callback.body.body[0].argument)
  ) {
    return callback.body.body[0].argument;
  }
  return null;
}

function runtimePattern(
  pattern: t.Identifier | t.ObjectPattern | t.ArrayPattern,
): typeof pattern {
  const cloned = t.cloneNode(pattern, true);
  t.traverseFast(cloned, (node) => {
    if (
      t.isIdentifier(node) ||
      t.isObjectPattern(node) ||
      t.isArrayPattern(node) ||
      t.isRestElement(node) ||
      t.isAssignmentPattern(node)
    ) {
      node.typeAnnotation = null;
    }
  });
  return cloned;
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
  componentPath: NodePath<t.FunctionDeclaration>,
  emitNode: NodeEmitter,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  if (
    (!t.isArrowFunctionExpression(source) &&
      !t.isFunctionExpression(source)) ||
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
    (!t.isIdentifier(first) &&
      !t.isObjectPattern(first) &&
      !t.isArrayPattern(first)) ||
    (second !== undefined && !t.isIdentifier(second))
  ) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: render callbacks take an item binding pattern and optional index, then return one JSX element',
    );
  }

  const itemPattern = runtimePattern(first);
  const itemBindings = Object.keys(t.getBindingIdentifiers(itemPattern));
  if (itemBindings.length === 0) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: render callback item patterns must bind at least one name',
    );
  }
  const itemParam = t.isIdentifier(itemPattern)
    ? itemPattern.name
    : itemBindings[0]!;
  const indexParam = second === undefined ? null : second.name;

  let keyExpression: t.Expression | null = null;
  jsx.openingElement.attributes = jsx.openingElement.attributes.filter(
    (attribute) => {
      if (
        t.isJSXSpreadAttribute(attribute) ||
        !t.isJSXIdentifier(attribute.name) ||
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
    ...(t.isIdentifier(ownerId) ? { ownerIdVar: ownerId.name } : {}),
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

  ownerScope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(liveRows),
        t.newExpression(t.identifier('Set'), []),
      ),
    ]),
  );
  ownerScope.updaters.push(() =>
    t.forOfStatement(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.cloneNode(nextUpdate)),
      ]),
      t.cloneNode(liveRows),
      t.expressionStatement(
        t.callExpression(t.cloneNode(nextUpdate), []),
      ),
    ),
  );

  const bindingUpdates: t.Statement[] = [
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.cloneNode(itemPattern, true),
        t.cloneNode(nextItem),
      ),
    ),
  ];
  if (nextIndex !== null && indexParam !== null) {
    bindingUpdates.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(indexParam),
          t.cloneNode(nextIndex),
        ),
      ),
    );
  }

  const create = t.arrowFunctionExpression(
    [
      t.cloneNode(itemPattern, true),
      t.cloneNode(rowId),
      ...(indexParam === null ? [] : [t.identifier(indexParam)]),
    ],
    t.blockStatement([
      cacheDecl(rowScope),
      updateDecl(rowScope),
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(refreshRow),
          t.arrowFunctionExpression(
            [],
            t.blockStatement([
              t.expressionStatement(
                t.callExpression(t.identifier(rowScope.updateVar), []),
              ),
              t.expressionStatement(
                t.callExpression(md(ctx, 'renderDescendants'), [
                  t.cloneNode(rowId),
                ]),
              ),
            ]),
          ),
        ),
      ]),
      registerStmt(
        ctx,
        t.cloneNode(rowId),
        t.cloneNode(ownerId, true),
        t.cloneNode(refreshRow),
      ),
      ...rowScope.creation,
      ...rowScope.mounts,
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.cloneNode(liveRows), t.identifier('add')),
          [t.cloneNode(refreshRow)],
        ),
      ),
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(
            t.identifier('nodes'),
            t.callExpression(md(ctx, 'rootNodes'), [t.identifier(root)]),
          ),
          t.objectProperty(
            t.identifier('entities'),
            t.arrayExpression([t.cloneNode(rowId)]),
          ),
          t.objectProperty(
            t.identifier('updateProps'),
            t.arrowFunctionExpression(
              [
                t.cloneNode(nextItem),
                ...(nextIndex === null ? [] : [t.cloneNode(nextIndex)]),
              ],
              t.blockStatement(bindingUpdates),
            ),
          ),
          t.objectProperty(
            t.identifier('update'),
            t.cloneNode(refreshRow),
          ),
          t.objectProperty(
            t.identifier('dispose'),
            t.arrowFunctionExpression(
              [],
              t.callExpression(
                t.memberExpression(
                  t.cloneNode(liveRows),
                  t.identifier('delete'),
                ),
                [t.cloneNode(refreshRow)],
              ),
            ),
          ),
        ]),
      ),
    ]),
  );
  const key =
    keyExpression === null
      ? t.nullLiteral()
      : t.arrowFunctionExpression(
          [
            t.cloneNode(itemPattern, true),
            ...(indexParam === null ? [] : [t.identifier(indexParam)]),
          ],
          t.cloneNode(keyExpression),
        );

  ownerScope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(adapter),
        t.objectExpression([
          t.objectProperty(t.identifier('create'), create),
          t.objectProperty(t.identifier('key'), key),
        ]),
      ),
    ]),
  );
  return adapter;
}

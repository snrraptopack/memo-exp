/**
 * components/children.ts - compiler-owned content slots for component children.
 *
 * A slot defers child creation until the callee mounts it into a real host
 * node. Its update closure remains attached to the lexical owner's update so
 * ordinary state routing and guarded DOM writes keep their existing shape.
 */

import * as t from '@babel/types';
import { nodeHasJsx, type Ctx } from '../context';
import {
  cacheDecl,
  newEmitScope,
  updateDecl,
  type EmitScope,
} from '../emission/scope';
import { generatedIdentifier, md } from '../identifiers';
import { matchMapCall } from '../lists';
import { matchCond } from '../conds';
import {
  localBindingForProp,
  objectBindingName,
  propNameForBinding,
} from './props';

export type EmitChildSlot = (
  scope: EmitScope,
  parentNode: t.Identifier,
  ownerId: t.Identifier,
) => void;
export type JsxChild = t.JSXElement['children'][number];

export interface ChildContentEmitters {
  emitText(expression: t.Expression): string;
  emitNode(node: t.JSXElement | t.JSXFragment): string;
  emitList(call: t.CallExpression, parentVar: string): void;
  emitCondition(
    expression: t.ConditionalExpression | t.LogicalExpression,
    parentVar: string,
  ): void;
  isForwarded(expression: t.Expression): boolean;
  emitForwarded(expression: t.Expression, parentVar: string): void;
  fail(message: string): never;
}

/**
 * React-compatible JSX text normalization shared by host and slot content.
 * Edge spaces are removed only when they come from source line breaks.
 */
export function normalizeJsxText(raw: string): string {
  let value = raw.replace(/\s+/g, ' ');
  if (/^\s*\n/.test(raw)) value = value.replace(/^ /, '');
  if (/\n\s*$/.test(raw)) value = value.replace(/ $/, '');
  return value;
}

/** Does a component element contain authored, non-whitespace children? */
export function hasComponentChildren(children: readonly JsxChild[]): boolean {
  return children.some(
    (child) => !t.isJSXText(child) || child.value.trim() !== '',
  );
}

/** Is an interpolation the component's reserved children-slot reference? */
export function isChildrenReference(
  ctx: Ctx,
  compName: string,
  expression: t.Expression,
): boolean {
  const plan = ctx.componentProps.get(compName);
  if (plan === undefined) return false;
  const objectBinding = objectBindingName(plan);
  if (objectBinding !== null) {
    return (
      t.isMemberExpression(expression) &&
      !expression.computed &&
      t.isIdentifier(expression.object, { name: objectBinding }) &&
      t.isIdentifier(expression.property, { name: 'children' })
    );
  }
  const local = localBindingForProp(plan, 'children');
  if (local !== null) {
    return t.isIdentifier(expression, { name: local });
  }
  return (
    t.isIdentifier(expression) &&
    expression.name === 'children' &&
    ctx.instanceDerivedBindings.get(compName)?.has('children') === true
  );
}

/** Declared render-prop name referenced by one interpolation/forwarding site. */
export function renderPropReferenceName(
  ctx: Ctx,
  compName: string,
  expression: t.Expression,
): string | null {
  const plan = ctx.componentProps.get(compName);
  if (plan === undefined) return null;
  const objectBinding = objectBindingName(plan);
  if (
    objectBinding !== null &&
    t.isMemberExpression(expression) &&
    !expression.computed &&
    t.isIdentifier(expression.object, { name: objectBinding }) &&
    t.isIdentifier(expression.property)
  ) {
    return expression.property.name;
  }
  if (t.isIdentifier(expression)) {
    const declared = propNameForBinding(plan, expression.name);
    if (declared !== null) return declared;
    if (
      expression.name === 'children' &&
      ctx.instanceDerivedBindings.get(compName)?.has('children') === true
    ) {
      return 'children';
    }
  }
  return null;
}

/** Is this expression one of the component's compiler-owned mount slots? */
export function isRenderPropReference(
  ctx: Ctx,
  compName: string,
  expression: t.Expression,
): boolean {
  const name = renderPropReferenceName(ctx, compName, expression);
  return (
    name !== null &&
    ctx.componentProps.get(compName)?.renderProps.includes(name) === true
  );
}

/**
 * Build a stable mount function and link its guarded update to `ownerScope`.
 * Child entity/list/conditional counters are shared with the lexical owner so
 * generated ids follow the same source-order analysis as direct JSX.
 */
export function buildChildrenSlot(
  ctx: Ctx,
  ownerScope: EmitScope,
  identityOwner: t.Expression,
  emit: EmitChildSlot,
): t.Identifier {
  const childScope = newEmitScope(ctx, true);
  childScope.childCounts = ownerScope.childCounts;
  childScope.usedPrefixes = ownerScope.usedPrefixes;
  childScope.usedConds = ownerScope.usedConds;

  const updateHolder = generatedIdentifier(ctx, 'childrenUpdate');
  const additionalUpdates = generatedIdentifier(ctx, 'childrenUpdates');
  const mountSequence = generatedIdentifier(ctx, 'childrenMountSequence');
  const mount = generatedIdentifier(ctx, 'children');
  const parentNode = generatedIdentifier(ctx, 'childrenParent');
  const mountOwner = generatedIdentifier(ctx, 'childrenOwner');
  const mountKey = generatedIdentifier(ctx, 'childrenKey');
  const slotOwner = generatedIdentifier(ctx, 'childrenSlot');
  const nextUpdate = generatedIdentifier(ctx, 'childrenNextUpdate');
  const active = generatedIdentifier(ctx, 'childrenActive');
  const dispose = generatedIdentifier(ctx, 'childrenDispose');
  emit(childScope, parentNode, slotOwner);

  ownerScope.creation.push(
    t.variableDeclaration('let', [
      t.variableDeclarator(t.cloneNode(updateHolder), t.nullLiteral()),
      t.variableDeclarator(t.cloneNode(additionalUpdates), t.nullLiteral()),
      t.variableDeclarator(t.cloneNode(mountSequence), t.numericLiteral(0)),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(mount),
        t.arrowFunctionExpression(
          [
            t.cloneNode(parentNode),
            t.cloneNode(mountOwner),
            t.cloneNode(mountKey),
          ],
          t.blockStatement([
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.cloneNode(slotOwner),
                t.conditionalExpression(
                  t.binaryExpression(
                    '===',
                    t.cloneNode(mountSequence),
                    t.numericLiteral(0),
                  ),
                  t.cloneNode(identityOwner, true),
                  t.binaryExpression(
                    '+',
                    t.binaryExpression(
                      '+',
                      t.cloneNode(identityOwner, true),
                      t.stringLiteral('/$slot['),
                    ),
                    t.binaryExpression(
                      '+',
                      t.cloneNode(mountSequence),
                      t.stringLiteral(']'),
                    ),
                  ),
                ),
              ),
            ]),
            t.expressionStatement(
              t.updateExpression('++', t.cloneNode(mountSequence)),
            ),
            t.variableDeclaration('let', [
              t.variableDeclarator(
                t.cloneNode(active),
                t.booleanLiteral(true),
              ),
            ]),
            cacheDecl(childScope),
            updateDecl(childScope),
            ...childScope.creation,
            ...childScope.mounts,
            t.ifStatement(
              t.binaryExpression(
                '===',
                t.cloneNode(updateHolder),
                t.nullLiteral(),
              ),
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.cloneNode(updateHolder),
                  t.identifier(childScope.updateVar),
                ),
              ),
              t.blockStatement([
                t.ifStatement(
                  t.binaryExpression(
                    '===',
                    t.cloneNode(additionalUpdates),
                    t.nullLiteral(),
                  ),
                  t.expressionStatement(
                    t.assignmentExpression(
                      '=',
                      t.cloneNode(additionalUpdates),
                      t.newExpression(t.identifier('Set'), []),
                    ),
                  ),
                ),
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.cloneNode(additionalUpdates),
                      t.identifier('add'),
                    ),
                    [t.identifier(childScope.updateVar)],
                  ),
                ),
              ]),
            ),
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.cloneNode(dispose),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement([
                    t.ifStatement(
                      t.unaryExpression('!', t.cloneNode(active)),
                      t.returnStatement(),
                    ),
                    t.expressionStatement(
                      t.assignmentExpression(
                        '=',
                        t.cloneNode(active),
                        t.booleanLiteral(false),
                      ),
                    ),
                    t.ifStatement(
                      t.binaryExpression(
                        '===',
                        t.cloneNode(updateHolder),
                        t.identifier(childScope.updateVar),
                      ),
                      t.expressionStatement(
                        t.assignmentExpression(
                          '=',
                          t.cloneNode(updateHolder),
                          t.nullLiteral(),
                        ),
                      ),
                      t.ifStatement(
                        t.binaryExpression(
                          '!==',
                          t.cloneNode(additionalUpdates),
                          t.nullLiteral(),
                        ),
                        t.expressionStatement(
                          t.callExpression(
                            t.memberExpression(
                              t.cloneNode(additionalUpdates),
                              t.identifier('delete'),
                            ),
                            [t.identifier(childScope.updateVar)],
                          ),
                        ),
                      ),
                    ),
                    ...childScope.disposableRegions.map((region) =>
                      t.expressionStatement(
                        t.callExpression(
                          t.memberExpression(
                            t.identifier(region),
                            t.identifier('dispose'),
                          ),
                          [],
                        ),
                      ),
                    ),
                    ...[...childScope.disposableCallbacks].reverse().map((callback) =>
                      t.ifStatement(
                        t.binaryExpression(
                          '!==',
                          t.cloneNode(callback),
                          t.nullLiteral(),
                        ),
                        t.expressionStatement(
                          t.callExpression(t.cloneNode(callback), []),
                        ),
                      ),
                    ),
                    ...childScope.disposableEntities.map((entity) =>
                      t.expressionStatement(
                        t.callExpression(md(ctx, 'unregisterSubtree'), [
                          t.cloneNode(entity, true),
                        ]),
                      ),
                    ),
                  ]),
                ),
              ),
            ]),
            t.expressionStatement(
              t.callExpression(md(ctx, 'cleanup'), [
                t.cloneNode(mountOwner),
                t.cloneNode(dispose),
              ]),
            ),
            t.returnStatement(t.cloneNode(dispose)),
          ]),
        ),
      ),
    ]),
  );
  ownerScope.updaters.push(() =>
    t.blockStatement([
      t.ifStatement(
        t.binaryExpression('!==', t.cloneNode(updateHolder), t.nullLiteral()),
        t.expressionStatement(t.callExpression(t.cloneNode(updateHolder), [])),
      ),
      t.ifStatement(
        t.binaryExpression(
          '!==',
          t.cloneNode(additionalUpdates),
          t.nullLiteral(),
        ),
        t.forOfStatement(
          t.variableDeclaration('const', [
            t.variableDeclarator(t.cloneNode(nextUpdate)),
          ]),
          t.cloneNode(additionalUpdates),
          t.expressionStatement(
            t.callExpression(t.cloneNode(nextUpdate), []),
          ),
        ),
      ),
    ]),
  );
  return mount;
}

/** Mount one forwarded slot with a structural owner and track branch teardown. */
export function emitForwardedSlotMount(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.Expression,
  parentVar: string,
  ownerId: t.Expression,
): void {
  const disposer = generatedIdentifier(ctx, 'slotDispose');
  const key = scope.forwardedSlotCounter++;
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(disposer),
        t.conditionalExpression(
          t.binaryExpression(
            '==',
            t.cloneNode(expression, true),
            t.nullLiteral(),
          ),
          t.nullLiteral(),
          t.callExpression(t.cloneNode(expression, true), [
            t.identifier(parentVar),
            t.cloneNode(ownerId, true),
            t.stringLiteral(String(key)),
          ]),
        ),
      ),
    ]),
  );
  scope.disposableCallbacks.push(disposer);
}

/** Emit lazy slot content into a callee-provided host in source order. */
export function emitChildrenIntoParent(
  scope: EmitScope,
  children: readonly JsxChild[],
  parentVar: string,
  emitters: ChildContentEmitters,
): void {
  const append = (childVar: string): void => {
    scope.creation.push(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(
            t.identifier(parentVar),
            t.identifier('appendChild'),
          ),
          [t.identifier(childVar)],
        ),
      ),
    );
  };

  for (const child of children) {
    if (t.isJSXText(child)) {
      const value = normalizeJsxText(child.value);
      if (value !== '') append(emitters.emitText(t.stringLiteral(value)));
      continue;
    }
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      append(emitters.emitNode(child));
      continue;
    }
    if (!t.isJSXExpressionContainer(child)) {
      emitters.fail('memo-dom: spread children are not supported (L1)');
    }
    if (t.isJSXEmptyExpression(child.expression)) continue;
    if (!t.isExpression(child.expression)) {
      emitters.fail('memo-dom: unsupported expression in component children');
    }

    const expression = child.expression;
    if (
      t.isNullLiteral(expression) ||
      t.isBooleanLiteral(expression) ||
      t.isIdentifier(expression, { name: 'undefined' })
    ) {
      continue;
    }
    if (emitters.isForwarded(expression)) {
      emitters.emitForwarded(expression, parentVar);
      continue;
    }
    const mapCall = matchMapCall(expression);
    if (mapCall !== null) {
      emitters.emitList(mapCall, parentVar);
      continue;
    }
    const condition = matchCond(expression);
    if (condition !== null && nodeHasJsx(condition)) {
      emitters.emitCondition(condition, parentVar);
      continue;
    }
    append(emitters.emitText(t.cloneNode(expression)));
  }
}

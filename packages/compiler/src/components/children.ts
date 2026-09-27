/**
 * components/children.ts - compiler-owned content slots for component children.
 *
 * A slot defers child creation until the callee mounts it into a real host
 * node. Its update closure remains attached to the lexical owner's update so
 * ordinary state routing and guarded DOM writes keep their existing shape.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  isIdentifier as isAstIdentifier,
  isMemberExpression as isAstMemberExpression,
  type BaseNode,
} from '../ast';
import { nodeHasJsx, type Ctx } from '../context';
import {
  cacheDecl,
  newEmitScope,
  updateDecl,
  type EmitScope,
} from '../emission/scope';
import { generatedIdentifier, md } from '../identifiers';
import { matchMapCall, type MapCallExpression } from '../lists';
import { matchCond } from '../conds';
import {
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
  emitList(call: MapCallExpression, parentVar: string): void;
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
    (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
  );
}

/** Declared render-prop name referenced by one interpolation/forwarding site. */
export function renderPropReferenceName(
  ctx: Ctx,
  compName: string,
  expression: BaseNode,
): string | null {
  const plan = ctx.componentProps.get(compName);
  if (plan === undefined) return null;
  const objectBinding = objectBindingName(plan);
  if (
    objectBinding !== null &&
    isAstMemberExpression(expression) &&
    !expression.computed &&
    isAstIdentifier(expression.object) &&
    expression.object.name === objectBinding &&
    isAstIdentifier(expression.property)
  ) {
    return expression.property.name;
  }
  if (isAstIdentifier(expression)) {
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
  childScope.dataSiteCounter = ownerScope.dataSiteCounter;
  childScope.coveredTransparentSources = new Set(
    ownerScope.coveredTransparentSources,
  );

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
    astFactory.variableDeclaration('let', [
      astFactory.variableDeclarator(cloneEstreeNode(updateHolder), astFactory.nullLiteral()),
      astFactory.variableDeclarator(cloneEstreeNode(additionalUpdates), astFactory.nullLiteral()),
      astFactory.variableDeclarator(cloneEstreeNode(mountSequence), astFactory.numericLiteral(0)),
    ]),
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(mount),
        astFactory.arrowFunctionExpression(
          [
            cloneEstreeNode(parentNode),
            cloneEstreeNode(mountOwner),
            cloneEstreeNode(mountKey),
          ],
          astFactory.blockStatement([
            astFactory.variableDeclaration('const', [
              astFactory.variableDeclarator(
                cloneEstreeNode(slotOwner),
                astFactory.conditionalExpression(
                  astFactory.binaryExpression(
                    '===',
                    cloneEstreeNode(mountSequence),
                    astFactory.numericLiteral(0),
                  ),
                  cloneEstreeNode(identityOwner, true),
                  astFactory.binaryExpression(
                    '+',
                    astFactory.binaryExpression(
                      '+',
                      cloneEstreeNode(identityOwner, true),
                      astFactory.stringLiteral('/$slot['),
                    ),
                    astFactory.binaryExpression(
                      '+',
                      cloneEstreeNode(mountSequence),
                      astFactory.stringLiteral(']'),
                    ),
                  ),
                ),
              ),
            ]),
            astFactory.expressionStatement(
              astFactory.updateExpression('++', cloneEstreeNode(mountSequence)),
            ),
            astFactory.variableDeclaration('let', [
              astFactory.variableDeclarator(
                cloneEstreeNode(active),
                astFactory.booleanLiteral(true),
              ),
            ]),
            cacheDecl(childScope),
            ...childScope.prelude,
            updateDecl(ctx, childScope),
            ...childScope.creation,
            ...childScope.mounts,
            astFactory.ifStatement(
              astFactory.binaryExpression(
                '===',
                cloneEstreeNode(updateHolder),
                astFactory.nullLiteral(),
              ),
              astFactory.expressionStatement(
                astFactory.assignmentExpression(
                  '=',
                  cloneEstreeNode(updateHolder),
                  astFactory.identifier(childScope.updateVar),
                ),
              ),
              astFactory.blockStatement([
                astFactory.ifStatement(
                  astFactory.binaryExpression(
                    '===',
                    cloneEstreeNode(additionalUpdates),
                    astFactory.nullLiteral(),
                  ),
                  astFactory.expressionStatement(
                    astFactory.assignmentExpression(
                      '=',
                      cloneEstreeNode(additionalUpdates),
                      astFactory.newExpression(astFactory.identifier('Set'), []),
                    ),
                  ),
                ),
                astFactory.expressionStatement(
                  astFactory.callExpression(
                    astFactory.memberExpression(
                      cloneEstreeNode(additionalUpdates),
                      astFactory.identifier('add'),
                    ),
                    [astFactory.identifier(childScope.updateVar)],
                  ),
                ),
              ]),
            ),
            astFactory.variableDeclaration('const', [
              astFactory.variableDeclarator(
                cloneEstreeNode(dispose),
                astFactory.arrowFunctionExpression(
                  [],
                  astFactory.blockStatement([
                    astFactory.ifStatement(
                      astFactory.unaryExpression('!', cloneEstreeNode(active)),
                      astFactory.returnStatement(),
                    ),
                    astFactory.expressionStatement(
                      astFactory.assignmentExpression(
                        '=',
                        cloneEstreeNode(active),
                        astFactory.booleanLiteral(false),
                      ),
                    ),
                    astFactory.ifStatement(
                      astFactory.binaryExpression(
                        '===',
                        cloneEstreeNode(updateHolder),
                        astFactory.identifier(childScope.updateVar),
                      ),
                      astFactory.expressionStatement(
                        astFactory.assignmentExpression(
                          '=',
                          cloneEstreeNode(updateHolder),
                          astFactory.nullLiteral(),
                        ),
                      ),
                      astFactory.ifStatement(
                        astFactory.binaryExpression(
                          '!==',
                          cloneEstreeNode(additionalUpdates),
                          astFactory.nullLiteral(),
                        ),
                        astFactory.expressionStatement(
                          astFactory.callExpression(
                            astFactory.memberExpression(
                              cloneEstreeNode(additionalUpdates),
                              astFactory.identifier('delete'),
                            ),
                            [astFactory.identifier(childScope.updateVar)],
                          ),
                        ),
                      ),
                    ),
                    ...childScope.disposableRegions.map((region) =>
                      astFactory.expressionStatement(
                        astFactory.callExpression(
                          astFactory.memberExpression(
                            astFactory.identifier(region),
                            astFactory.identifier('dispose'),
                          ),
                          [],
                        ),
                      ),
                    ),
                    ...[...childScope.disposableCallbacks].reverse().map((callback) =>
                      astFactory.ifStatement(
                        astFactory.binaryExpression(
                          '!==',
                          cloneEstreeNode(callback),
                          astFactory.nullLiteral(),
                        ),
                        astFactory.expressionStatement(
                          astFactory.callExpression(cloneEstreeNode(callback), []),
                        ),
                      ),
                    ),
                    ...childScope.disposableEntities.map((entity) =>
                      astFactory.expressionStatement(
                        astFactory.callExpression(md(ctx, 'unregisterSubtree'), [
                          cloneEstreeNode(entity, true),
                        ]),
                      ),
                    ),
                  ]),
                ),
              ),
            ]),
            astFactory.expressionStatement(
              astFactory.callExpression(md(ctx, 'cleanup'), [
                cloneEstreeNode(mountOwner),
                cloneEstreeNode(dispose),
              ]),
            ),
            astFactory.returnStatement(cloneEstreeNode(dispose)),
          ]),
        ),
      ),
    ]),
  );
  ownerScope.updaters.push(() =>
    astFactory.blockStatement([
      astFactory.ifStatement(
        astFactory.binaryExpression('!==', cloneEstreeNode(updateHolder), astFactory.nullLiteral()),
        astFactory.expressionStatement(astFactory.callExpression(cloneEstreeNode(updateHolder), [])),
      ),
      astFactory.ifStatement(
        astFactory.binaryExpression(
          '!==',
          cloneEstreeNode(additionalUpdates),
          astFactory.nullLiteral(),
        ),
        astFactory.forOfStatement(
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(cloneEstreeNode(nextUpdate)),
          ]),
          cloneEstreeNode(additionalUpdates),
          astFactory.expressionStatement(
            astFactory.callExpression(cloneEstreeNode(nextUpdate), []),
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
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(disposer),
        astFactory.conditionalExpression(
          astFactory.binaryExpression(
            '==',
            cloneEstreeNode(expression, true),
            astFactory.nullLiteral(),
          ),
          astFactory.nullLiteral(),
          astFactory.callExpression(cloneEstreeNode(expression, true), [
            astFactory.identifier(parentVar),
            cloneEstreeNode(ownerId, true),
            astFactory.stringLiteral(String(key)),
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
      astFactory.expressionStatement(
        astFactory.callExpression(
          astFactory.memberExpression(
            astFactory.identifier(parentVar),
            astFactory.identifier('appendChild'),
          ),
          [astFactory.identifier(childVar)],
        ),
      ),
    );
  };

  for (const child of children) {
    if (astFactory.isJSXText(child)) {
      const value = normalizeJsxText(child.value);
      if (value !== '') append(emitters.emitText(astFactory.stringLiteral(value)));
      continue;
    }
    if (astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)) {
      append(emitters.emitNode(child));
      continue;
    }
    if (!astFactory.isJSXExpressionContainer(child)) {
      emitters.fail('memo-dom: spread children are not supported (L1)');
    }
    if (astFactory.isJSXEmptyExpression(child.expression)) continue;
    if (!astFactory.isExpression(child.expression)) {
      emitters.fail('memo-dom: unsupported expression in component children');
    }

    const expression = child.expression;
    if (
      astFactory.isNullLiteral(expression) ||
      astFactory.isBooleanLiteral(expression) ||
      astFactory.isIdentifier(expression, { name: 'undefined' })
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
    append(emitters.emitText(cloneEstreeNode(expression)));
  }
}

/**
 * components/children.ts - compiler-owned content slots for component children.
 *
 * A slot defers child creation until the callee mounts it into a real host
 * node. Its update closure remains attached to the lexical owner's update so
 * ordinary state routing and guarded DOM writes keep their existing shape.
 */

import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { cloneNode as cloneEstreeNode } from '../../ast';
import { type DomContext as Ctx } from '../context';
import { cacheDecl, newEmitScope, updateDecl, type EmitScope } from '../scope';
import { generatedIdentifier, md } from '../identifiers';
import type { MapCallExpression } from '../../lists';
import { planDirectChildren } from '../../jsx/children';
import { materializeDirectChildren } from '../direct-children';
import { initialBindingsDeclaration, freshInitialStatement, type InitialDomSlot } from '../initial-dom';
import { initialSite, initialSlotMountKey } from '../../planning/initial-content';
import { applyStaticMarkup } from '../markup';

export type EmitChildSlot = (
  scope: EmitScope,
  parentNode: t.Identifier,
  ownerId: t.Identifier,
) => void;
import type {JsxChild} from '../../jsx/children';

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

/** Does a component element contain authored, non-whitespace children? */
export function hasComponentChildren(children: readonly JsxChild[]): boolean {
  return children.some(
    (child) => !astFactory.isJSXText(child) || child.value !== '',
  );
}

import {renderPropReferenceName} from '../../analysis/render-prop-reference';

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
  initial?: InitialDomSlot,
): t.Identifier {
  const childScope = newEmitScope(ctx, true, ownerScope);
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
  const adopting = initial?.plan.retainCreation ? generatedIdentifier(ctx, 'initialChildrenHost') : null;
  const slotOwner = generatedIdentifier(ctx, 'childrenSlot');
  const nextUpdate = generatedIdentifier(ctx, 'childrenNextUpdate');
  const active = generatedIdentifier(ctx, 'childrenActive');
  const dispose = generatedIdentifier(ctx, 'childrenDispose');
  const singleMount = initial !== undefined && Object.keys(initial.mounts).length === 1;
  const varyingOffset = initial && Object.values(initial.mounts).some(offset=>offset!==initial.offset);
  const offset = varyingOffset ? generatedIdentifier(ctx,'childrenOffset') : null;
  if (initial) childScope.initialDom={plan:initial.plan,variable:generatedIdentifier(ctx,'initialChildrenNodes').name,
    descriptors:[],...(offset?{offset}: {}),...(adopting?{adopting}: {})};
  emit(childScope, parentNode, slotOwner);
  if (initial?.static && childScope.updaters.length === 0 && childScope.mounts.length === 0 &&
      childScope.disposableEntities.length === 0 && childScope.disposableRegions.length === 0 &&
      childScope.disposableCallbacks.length === 0) {
    // A static slot in an interactive callee still supplies the existing ABI,
    // but has neither a browser update nor a lifetime to retain.
    ownerScope.creation.push(astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(cloneEstreeNode(mount),
        astFactory.arrowFunctionExpression([], astFactory.nullLiteral())),
    ]));
    return mount;
  }
  if (initial) {
    childScope.prelude.unshift(
      ...(offset ? [astFactory.variableDeclaration('const',[astFactory.variableDeclarator(offset,
        astFactory.memberExpression(astFactory.objectExpression(Object.entries(initial.mounts).map(([key,value])=>
          astFactory.objectProperty(astFactory.stringLiteral(key),astFactory.numericLiteral(value-initial.offset)))),
        cloneEstreeNode(mountKey),true))])] : []),
      initialBindingsDeclaration(ctx,childScope,cloneEstreeNode(parentNode)),
    );
  }

  // Slots use the same creation optimizer as components, including the guarded
  // future-creation arm of an initial binding. Keep the materialized update as
  // an explicit consumer so nodes used only by later updates remain bound.
  const updateStatement = updateDecl(ctx, childScope);
  applyStaticMarkup(ctx, childScope, null, [updateStatement]);

  ownerScope.creation.push(
    astFactory.variableDeclaration('let', [
      astFactory.variableDeclarator(cloneEstreeNode(updateHolder), astFactory.nullLiteral()),
      ...(!singleMount ? [
        astFactory.variableDeclarator(cloneEstreeNode(additionalUpdates), astFactory.nullLiteral()),
        astFactory.variableDeclarator(cloneEstreeNode(mountSequence), astFactory.numericLiteral(0)),
      ] : []),
    ]),
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(mount),
        astFactory.arrowFunctionExpression(
          [
            cloneEstreeNode(parentNode),
            cloneEstreeNode(mountOwner),
            cloneEstreeNode(mountKey),
            ...(adopting?[cloneEstreeNode(adopting)]:[]),
          ],
          astFactory.blockStatement([
            astFactory.variableDeclaration('const', [
              astFactory.variableDeclarator(
                cloneEstreeNode(slotOwner),
                singleMount ? cloneEstreeNode(identityOwner, true) : astFactory.conditionalExpression(
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
            ...(!singleMount ? [astFactory.expressionStatement(
              astFactory.updateExpression('++', cloneEstreeNode(mountSequence)),
            )] : []),
            astFactory.variableDeclaration('let', [
              astFactory.variableDeclarator(
                cloneEstreeNode(active),
                astFactory.booleanLiteral(true),
              ),
            ]),
            cacheDecl(childScope),
            ...childScope.prelude,
            updateStatement,
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
              singleMount ? null : astFactory.blockStatement([
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
                      singleMount ? null : astFactory.ifStatement(
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
      ...(!singleMount ? [astFactory.ifStatement(
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
      )] : []),
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
            astFactory.stringLiteral(scope.initialDom
              ? initialSlotMountKey(ctx.moduleId,scope.initialDom.plan.component,initialSite(expression)) : String(key)),
            ...(scope.initialDom?.adopting?[scope.initialDom.adopting]:[]),
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
    if (scope.initialDom && !scope.initialDom.adopting) return;
    scope.creation.push(
      freshInitialStatement(scope,astFactory.expressionStatement(
        astFactory.callExpression(
          astFactory.memberExpression(
            astFactory.identifier(parentVar),
            astFactory.identifier('appendChild'),
          ),
          [astFactory.identifier(childVar)],
        ),
      )),
    );
  };

  const operations=materializeDirectChildren(planDirectChildren(children,{
    isForwarded:emitters.isForwarded,fail:emitters.fail,
  }),emitters);
  for (const operation of operations) {
    if (operation.type==='node') append(operation.variable);
    else if (operation.type==='slot') emitters.emitForwarded(operation.expression,parentVar);
    else if (operation.type==='list') emitters.emitList(operation.expression,parentVar);
    else emitters.emitCondition(operation.expression,parentVar);
  }
}

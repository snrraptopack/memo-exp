/**
 * children.ts - compiler-owned content slots for static component children.
 *
 * A slot defers child creation until the callee mounts it into a real host
 * node. Its update closure remains attached to the lexical owner's update so
 * ordinary state routing and guarded DOM writes keep their existing shape.
 */

import * as t from '@babel/types';
import { nodeHasJsx, type Ctx } from './context';
import {
  cacheDecl,
  newEmitScope,
  updateDecl,
  type EmitScope,
} from './emission-scope';
import { generatedIdentifier } from './identifiers';
import { matchMapCall } from './lists';
import { matchCond } from './conds';

export type EmitChildSlot = (
  scope: EmitScope,
  parentNode: t.Identifier,
) => void;
export type JsxChild = t.JSXElement['children'][number];

export interface ChildContentEmitters {
  emitText(expression: t.Expression): string;
  emitElement(element: t.JSXElement): string;
  emitList(call: t.CallExpression, parentVar: string): void;
  emitCondition(
    expression: t.ConditionalExpression | t.LogicalExpression,
    parentVar: string,
  ): void;
  isForwarded(expression: t.Expression): boolean;
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
  const params = ctx.compPropNames.get(compName) ?? [];
  if (ctx.objectPropComponents.has(compName)) {
    return (
      t.isMemberExpression(expression) &&
      !expression.computed &&
      t.isIdentifier(expression.object, { name: params[0] }) &&
      t.isIdentifier(expression.property, { name: 'children' })
    );
  }
  return (
    t.isIdentifier(expression, { name: 'children' }) &&
    params.includes('children')
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
  emit: EmitChildSlot,
): t.Identifier {
  const childScope = newEmitScope(ctx);
  childScope.childCounts = ownerScope.childCounts;
  childScope.usedPrefixes = ownerScope.usedPrefixes;
  childScope.usedConds = ownerScope.usedConds;

  const updateHolder = generatedIdentifier(ctx, 'childrenUpdate');
  const mount = generatedIdentifier(ctx, 'children');
  const parentNode = generatedIdentifier(ctx, 'childrenParent');
  emit(childScope, parentNode);

  ownerScope.creation.push(
    t.variableDeclaration('let', [
      t.variableDeclarator(t.cloneNode(updateHolder), t.nullLiteral()),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(mount),
        t.arrowFunctionExpression(
          [t.cloneNode(parentNode)],
          t.blockStatement([
            t.ifStatement(
              t.binaryExpression(
                '!==',
                t.cloneNode(updateHolder),
                t.nullLiteral(),
              ),
              t.throwStatement(
                t.newExpression(t.identifier('Error'), [
                  t.stringLiteral(
                    '[memo-dom] a component children slot can only be mounted once',
                  ),
                ]),
              ),
            ),
            cacheDecl(childScope),
            updateDecl(childScope),
            ...childScope.creation,
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.cloneNode(updateHolder),
                t.identifier(childScope.updateVar),
              ),
            ),
          ]),
        ),
      ),
    ]),
  );
  ownerScope.updaters.push(() =>
    t.ifStatement(
      t.binaryExpression('!==', t.cloneNode(updateHolder), t.nullLiteral()),
      t.expressionStatement(t.callExpression(t.cloneNode(updateHolder), [])),
    ),
  );
  return mount;
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
    if (t.isJSXElement(child)) {
      append(emitters.emitElement(child));
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
      scope.creation.push(
        t.ifStatement(
          t.binaryExpression('!=', t.cloneNode(expression), t.nullLiteral()),
          t.expressionStatement(
            t.callExpression(t.cloneNode(expression), [
              t.identifier(parentVar),
            ]),
          ),
        ),
      );
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

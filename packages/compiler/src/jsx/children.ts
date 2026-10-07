/**
 * jsx/children.ts - direct JSX child classification for host-like parents.
 *
 * Host elements and fragments share the same child semantics. This module
 * classifies text, nodes, lists, conditional regions, and forwarded slots
 * without deciding when the eventual parent node is created.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { nodeHasJsx } from '../context/ast';
import { matchCond } from '../conds';
import type { MapCallExpression } from '../context/model';
import { matchMapCall } from '../lists/source-shapes';
import { combineTextExpressions } from '../components/text-expression';

export type JsxChild = t.JSXElement['children'][number];

export type JsxNode = t.JSXElement | t.JSXFragment;

export type DirectChildPlan =
  | { type: 'text'; expression: t.Expression }
  | { type: 'node'; node: JsxNode }
  | { type: 'list'; expression: MapCallExpression }
  | {
      type: 'condition';
      expression: t.ConditionalExpression | t.LogicalExpression;
    }
  | { type: 'slot'; expression: t.Expression };

export interface DirectChildClassifier {
  isForwarded(expression: t.Expression): boolean;
  fail(message: string): never;
}

/** Plan child semantics without allocating nodes or emitting backend code. */
export function planDirectChildren(
  children: readonly t.JSXElement['children'][number][],
  classifier: DirectChildClassifier,
): DirectChildPlan[] {
  const result: DirectChildPlan[] = [];
  let pendingText: t.Expression[] = [];

  const flushText = (): void => {
    if (pendingText.length === 0) return;
    const combined = combineTextExpressions(pendingText);
    pendingText = [];
    result.push({
      type: 'text',
      expression: combined,
    });
  };

  for (const child of children) {
    if (astFactory.isJSXText(child)) {
      const value = child.value;
      if (value !== '') {
        pendingText.push(astFactory.stringLiteral(value));
      }
      continue;
    }
    if (astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)) {
      flushText();
      result.push({ type: 'node', node: child });
      continue;
    }
    if (!astFactory.isJSXExpressionContainer(child)) {
      classifier.fail('memo-dom: spread children are not supported');
    }
    if (astFactory.isJSXEmptyExpression(child.expression)) continue;
    if (!astFactory.isExpression(child.expression)) {
      classifier.fail('memo-dom: unsupported expression in JSX child position');
    }

    const expression = child.expression;
    if (classifier.isForwarded(expression)) {
      flushText();
      result.push({ type: 'slot', expression: cloneEstreeNode(expression) });
      continue;
    }
    if (
      astFactory.isNullLiteral(expression) ||
      astFactory.isBooleanLiteral(expression) ||
      astFactory.isIdentifier(expression, { name: 'undefined' })
    ) {
      continue;
    }
    const mapCall = matchMapCall(expression);
    if (mapCall !== null) {
      flushText();
      result.push({ type: 'list', expression: mapCall });
      continue;
    }
    const condition = matchCond(expression);
    if (condition !== null && nodeHasJsx(condition)) {
      flushText();
      result.push({ type: 'condition', expression: condition });
      continue;
    }

    pendingText.push(cloneEstreeNode(expression));
  }

  flushText();
  return result;
}


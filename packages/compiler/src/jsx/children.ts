/**
 * jsx/children.ts - direct JSX child classification for host-like parents.
 *
 * Host elements and fragments share the same child semantics. This module
 * classifies text, nodes, lists, conditional regions, and forwarded slots
 * without deciding when the eventual parent node is created.
 */

import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { nodeHasJsx } from '../context';
import { matchCond } from '../conds';
import {
  normalizeJsxText,
  type JsxChild,
} from '../components/children';
import { matchMapCall, type MapCallExpression } from '../lists';

export type JsxNode = t.JSXElement | t.JSXFragment;

export type DirectChildOperation =
  | { type: 'node'; variable: string }
  | { type: 'list'; expression: MapCallExpression }
  | {
      type: 'condition';
      expression: t.ConditionalExpression | t.LogicalExpression;
    }
  | { type: 'slot'; expression: t.Expression };

export interface DirectChildEmitters {
  emitText(expression: t.Expression): string;
  emitNode(node: JsxNode): string;
  isForwarded(expression: t.Expression): boolean;
  fail(message: string): never;
}

function combineTextExpressions(expressions: t.Expression[]): t.Expression {
  if (expressions.length === 1) return expressions[0]!;

  const merged: t.Expression[] = [];
  for (const expr of expressions) {
    const last = merged[merged.length - 1];
    if (last && astFactory.isStringLiteral(last) && astFactory.isStringLiteral(expr)) {
      merged[merged.length - 1] = astFactory.stringLiteral(last.value + expr.value);
    } else {
      merged.push(expr);
    }
  }
  if (merged.length === 1) return merged[0]!;

  const hasString = merged.some((e) => astFactory.isStringLiteral(e));
  let result: t.Expression = hasString
    ? merged[0]!
    : astFactory.binaryExpression('+', astFactory.stringLiteral(''), merged[0]!);

  for (let i = 1; i < merged.length; i++) {
    result = astFactory.binaryExpression('+', result, merged[i]!);
  }
  return result;
}

/** Classify and emit immediate child nodes in authored source order. */
export function collectDirectChildren(
  children: readonly JsxChild[],
  emitters: DirectChildEmitters,
): DirectChildOperation[] {
  const result: DirectChildOperation[] = [];
  let pendingText: t.Expression[] = [];

  const flushText = (): void => {
    if (pendingText.length === 0) return;
    const combined = combineTextExpressions(pendingText);
    pendingText = [];
    result.push({
      type: 'node',
      variable: emitters.emitText(combined),
    });
  };

  for (const child of children) {
    if (astFactory.isJSXText(child)) {
      const value = normalizeJsxText(child.value);
      if (value !== '') {
        pendingText.push(astFactory.stringLiteral(value));
      }
      continue;
    }
    if (astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)) {
      flushText();
      result.push({ type: 'node', variable: emitters.emitNode(child) });
      continue;
    }
    if (!astFactory.isJSXExpressionContainer(child)) {
      emitters.fail('memo-dom: spread children are not supported');
    }
    if (astFactory.isJSXEmptyExpression(child.expression)) continue;
    if (!astFactory.isExpression(child.expression)) {
      emitters.fail('memo-dom: unsupported expression in JSX child position');
    }

    const expression = child.expression;
    if (emitters.isForwarded(expression)) {
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


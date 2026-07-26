/**
 * jsx/children.ts - direct JSX child classification for host-like parents.
 *
 * Host elements and fragments share the same child semantics. This module
 * classifies text, nodes, lists, conditional regions, and forwarded slots
 * without deciding when the eventual parent node is created.
 */

import * as t from '@babel/types';
import { nodeHasJsx } from '../context';
import { matchCond } from '../conds';
import {
  normalizeJsxText,
  type JsxChild,
} from '../components/children';
import { matchMapCall } from '../lists';

export type JsxNode = t.JSXElement | t.JSXFragment;

export type DirectChildOperation =
  | { type: 'node'; variable: string }
  | { type: 'list'; expression: t.CallExpression }
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

/** Classify and emit immediate child nodes in authored source order. */
export function collectDirectChildren(
  children: readonly JsxChild[],
  emitters: DirectChildEmitters,
): DirectChildOperation[] {
  const result: DirectChildOperation[] = [];
  const meaningful = children.filter(
    (child) => !t.isJSXText(child) || child.value.trim() !== '',
  );

  for (const child of children) {
    if (t.isJSXText(child)) {
      const value = normalizeJsxText(child.value);
      if (value !== '') {
        result.push({
          type: 'node',
          variable: emitters.emitText(t.stringLiteral(value)),
        });
      }
      continue;
    }
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      result.push({ type: 'node', variable: emitters.emitNode(child) });
      continue;
    }
    if (!t.isJSXExpressionContainer(child)) {
      emitters.fail('memo-dom: spread children are not supported');
    }
    if (t.isJSXEmptyExpression(child.expression)) continue;
    if (!t.isExpression(child.expression)) {
      emitters.fail('memo-dom: unsupported expression in JSX child position');
    }

    const expression = child.expression;
    if (emitters.isForwarded(expression)) {
      if (meaningful.length !== 1) {
        emitters.fail(
          'memo-dom: a component children slot must be the sole child of its host insertion element',
        );
      }
      result.push({ type: 'slot', expression: t.cloneNode(expression) });
      continue;
    }
    if (
      t.isNullLiteral(expression) ||
      t.isBooleanLiteral(expression) ||
      t.isIdentifier(expression, { name: 'undefined' })
    ) {
      continue;
    }
    const mapCall = matchMapCall(expression);
    if (mapCall !== null) {
      result.push({ type: 'list', expression: mapCall });
      continue;
    }
    const condition = matchCond(expression);
    if (condition !== null && nodeHasJsx(condition)) {
      result.push({ type: 'condition', expression: condition });
      continue;
    }
    result.push({
      type: 'node',
      variable: emitters.emitText(t.cloneNode(expression)),
    });
  }
  return result;
}

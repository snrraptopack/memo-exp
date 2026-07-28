/**
 * conds.ts - conditional-site analysis.
 *
 * Direct JSX-child ternaries and logical conditions become anchored regions.
 * Right-associated ternary chains flatten into one multi-branch region.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx } from './context';
import { matchMapCall } from './lists';
import type { JsxNode } from './jsx/children';

export interface CondSite {
  /** Expression selecting an index in branches. */
  pickExpr: t.Expression;
  branches: (JsxNode | null)[];
  /** `when0`, `when1`, ... per owner, source order. */
  suffix: string;
}

export function matchCond(
  expr: t.Node,
): t.ConditionalExpression | t.LogicalExpression | null {
  if (t.isConditionalExpression(expr)) return expr;
  if (
    t.isLogicalExpression(expr) &&
    (expr.operator === '&&' || expr.operator === '||')
  ) {
    return expr;
  }
  return null;
}

function isEmptyBranch(node: t.Node): boolean {
  return (
    t.isNullLiteral(node) ||
    t.isBooleanLiteral(node, { value: false }) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

function validateBranchJsx(jsx: JsxNode, fail: (msg: string) => never): void {
  const stack: t.Node[] = [jsx];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (t.isJSXElement(node)) {
      for (const attribute of node.openingElement.attributes) {
        if (
          !t.isJSXSpreadAttribute(attribute) &&
          (attribute.name as t.JSXIdentifier).name === 'key'
        ) {
          fail('memo-dom: key={...} is only meaningful on list rows');
        }
      }
      stack.push(...node.children);
    } else if (t.isJSXFragment(node)) {
      stack.push(...node.children);
    } else if (
      t.isJSXExpressionContainer(node) &&
      t.isExpression(node.expression)
    ) {
      const expression = node.expression;
      if (matchCond(expression) !== null && nodeHasJsx(expression)) {
        fail(
          'memo-dom: nested conditionals inside branches are not supported yet — hoist the inner conditional into a component',
        );
      }
      if (matchMapCall(expression) !== null && nodeHasJsx(expression)) {
        continue;
      }
    }
  }
}

export function analyzeCondSite(
  expr: t.ConditionalExpression | t.LogicalExpression,
  errorAt: Pick<NodePath, 'buildCodeFrameError'>,
  usedConds: { count: number },
): CondSite {
  const fail = (message: string): never => {
    throw errorAt.buildCodeFrameError(message);
  };

  let pickExpr: t.Expression;
  let branchNodes: (t.Node | null)[];
  if (t.isConditionalExpression(expr)) {
    const tests: t.Expression[] = [];
    branchNodes = [];
    let current: t.Expression = expr;
    while (t.isConditionalExpression(current)) {
      tests.push(t.cloneNode(current.test));
      branchNodes.push(current.consequent);
      current = current.alternate;
    }
    branchNodes.push(current);
    pickExpr = t.numericLiteral(branchNodes.length - 1);
    for (let index = tests.length - 1; index >= 0; index--) {
      pickExpr = t.conditionalExpression(
        tests[index]!,
        t.numericLiteral(index),
        pickExpr,
      );
    }
  } else if (expr.operator === '&&') {
    pickExpr = t.conditionalExpression(
      t.cloneNode(expr.left),
      t.numericLiteral(0),
      t.numericLiteral(1),
    );
    branchNodes = [expr.right, null];
  } else {
    pickExpr = t.conditionalExpression(
      t.cloneNode(expr.left),
      t.numericLiteral(1),
      t.numericLiteral(0),
    );
    branchNodes = [expr.right, null];
  }

  const resolveBranch = (node: t.Node | null): JsxNode | null => {
    if (node === null || isEmptyBranch(node)) return null;
    if (t.isJSXElement(node) || t.isJSXFragment(node)) return node;
    return fail(
      'memo-dom: conditional branches must be JSX elements/fragments or null/false — for text use an interpolation',
    );
  };
  const branches = branchNodes.map(resolveBranch);
  for (const branch of branches) {
    if (branch !== null) validateBranchJsx(branch, fail);
  }

  return {
    pickExpr,
    branches,
    suffix: `when${usedConds.count++}`,
  };
}

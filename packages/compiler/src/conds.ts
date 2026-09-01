/**
 * conds.ts - conditional-site analysis.
 *
 * Direct JSX-child ternaries and logical conditions become anchored regions.
 * Right-associated ternary chains flatten into one multi-branch region.
 */
import type * as t from '@babel/types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import { nodeHasJsx } from './context';
import { matchMapCall } from './lists';
import type { JsxNode } from './jsx/children';

interface ErrorPath {
  buildCodeFrameError(message: string): Error;
}

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
  if (astFactory.isConditionalExpression(expr)) return expr;
  if (
    astFactory.isLogicalExpression(expr) &&
    (expr.operator === '&&' || expr.operator === '||')
  ) {
    return expr;
  }
  return null;
}

function isEmptyBranch(node: t.Node): boolean {
  return (
    astFactory.isNullLiteral(node) ||
    astFactory.isBooleanLiteral(node, { value: false }) ||
    astFactory.isIdentifier(node, { name: 'undefined' })
  );
}

function validateBranchJsx(jsx: JsxNode, fail: (msg: string) => never): void {
  const stack: t.Node[] = [jsx];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (astFactory.isJSXElement(node)) {
      for (const attribute of node.openingElement.attributes) {
        if (
          !astFactory.isJSXSpreadAttribute(attribute) &&
          (attribute.name as t.JSXIdentifier).name === 'key'
        ) {
          fail('memo-dom: key={...} is only meaningful on list rows');
        }
      }
      stack.push(...node.children);
    } else if (astFactory.isJSXFragment(node)) {
      stack.push(...node.children);
    } else if (
      astFactory.isJSXExpressionContainer(node) &&
      astFactory.isExpression(node.expression)
    ) {
      const expression = node.expression;
      if (matchMapCall(expression) !== null && nodeHasJsx(expression)) {
        continue;
      }
    }
  }
}

export function analyzeCondSite(
  expr: t.ConditionalExpression | t.LogicalExpression,
  errorAt: ErrorPath,
  usedConds: { count: number },
): CondSite {
  const fail = (message: string): never => {
    throw errorAt.buildCodeFrameError(message);
  };

  let pickExpr: t.Expression;
  let branchNodes: (t.Node | null)[];
  if (astFactory.isConditionalExpression(expr)) {
    const tests: t.Expression[] = [];
    branchNodes = [];
    let current: t.Expression = expr;
    while (astFactory.isConditionalExpression(current)) {
      tests.push(cloneEstreeNode(current.test));
      branchNodes.push(current.consequent);
      current = current.alternate;
    }
    branchNodes.push(current);
    pickExpr = astFactory.numericLiteral(branchNodes.length - 1);
    for (let index = tests.length - 1; index >= 0; index--) {
      pickExpr = astFactory.conditionalExpression(
        tests[index]!,
        astFactory.numericLiteral(index),
        pickExpr,
      );
    }
  } else if (expr.operator === '&&') {
    pickExpr = astFactory.conditionalExpression(
      cloneEstreeNode(expr.left),
      astFactory.numericLiteral(0),
      astFactory.numericLiteral(1),
    );
    branchNodes = [expr.right, null];
  } else {
    pickExpr = astFactory.conditionalExpression(
      cloneEstreeNode(expr.left),
      astFactory.numericLiteral(1),
      astFactory.numericLiteral(0),
    );
    branchNodes = [expr.right, null];
  }

  const resolveBranch = (node: t.Node | null): JsxNode | null => {
    if (node === null || isEmptyBranch(node)) return null;
    if (astFactory.isJSXElement(node) || astFactory.isJSXFragment(node)) return node;
    if (astFactory.isExpression(node)) {
      return astFactory.jsxFragment(
        astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(),
        [astFactory.jsxExpressionContainer(cloneEstreeNode(node, true))],
      );
    }
    return fail(
      'memo-dom: conditional branches must be JSX, renderable text expressions, or null/false',
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

/**
 * conds.ts — R8 conditional-site analysis (pure: no emission here, see emit.ts).
 *
 * Recognizes `{cond ? <A/> : <B/>}` and `{cond && <A/>}` / `{cond || <A/>}`
 * in direct JSX child position (position itself is enforced by the caller),
 * validates the L1 form, and names the region ('when0', 'when1', … per
 * owner, source order — analysis and emission share the counter convention
 * so table patterns always match runtime ids).
 *
 * L1 form rules (each a clear compile error):
 *   - branches must be JSX elements or empty (null / false / undefined) —
 *     text branches are rejected (use a text interpolation)
 *   - statically mounted components are branch-owned entities
 *   - mapped lists may be nested in branches and are branch-owned
 *   - no nested conditionals inside branches
 *   - no key={...} outside a mapped row (meaningless there)
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx } from './context';
import { matchMapCall } from './lists';

export interface CondSite {
  /** The full pick expression `test ? 0 : 1` (index of the branch to mount). */
  pickExpr: t.Expression;
  thenJsx: t.JSXElement | null;
  elseJsx: t.JSXElement | null;
  /** 'when0', 'when1', … per owner, source order. */
  suffix: string;
}

/** A ternary, or a logical && / || — the R8 conditional source forms. */
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

/** Is this node empty-branch material? (null / false / undefined) */
function isEmptyBranch(node: t.Node): boolean {
  return (
    t.isNullLiteral(node) ||
    t.isBooleanLiteral(node, { value: false }) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

/** Branch content rules — walks the raw JSX tree (no NodePaths here). */
function validateBranchJsx(jsx: t.JSXElement, fail: (msg: string) => never): void {
  const stack: t.Node[] = [jsx];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (t.isJSXElement(n)) {
      for (const attr of n.openingElement.attributes) {
        if (!t.isJSXSpreadAttribute(attr) && (attr.name as t.JSXIdentifier).name === 'key') {
          fail('memo-dom: key={...} is only meaningful on list rows');
        }
      }
      stack.push(...n.children);
    } else if (t.isJSXExpressionContainer(n) && t.isExpression(n.expression)) {
      const ex = n.expression;
      if (matchCond(ex) !== null && nodeHasJsx(ex)) {
        fail(
          'memo-dom: nested conditionals inside branches are not supported yet (R8 L1) — hoist the inner conditional into a component',
        );
      }
      if (matchMapCall(ex) !== null && nodeHasJsx(ex)) {
        // analyzeMapSite validates the callback. Do not walk a component row
        // as if it were a statically mounted component in the branch.
        continue;
      }
    }
  }
}

/**
 * Validate and describe a conditional site. `errorAt` provides code frames;
 * `usedConds` is the owner's region counter (shared by both passes).
 */
export function analyzeCondSite(
  expr: t.ConditionalExpression | t.LogicalExpression,
  errorAt: Pick<NodePath, 'buildCodeFrameError'>,
  usedConds: { count: number },
): CondSite {
  const fail = (msg: string): never => {
    throw errorAt.buildCodeFrameError(msg);
  };

  let pickExpr: t.Expression;
  let thenNode: t.Node;
  let elseNode: t.Node | null;

  if (t.isConditionalExpression(expr)) {
    pickExpr = t.conditionalExpression(
      t.cloneNode(expr.test),
      t.numericLiteral(0),
      t.numericLiteral(1),
    );
    thenNode = expr.consequent;
    elseNode = expr.alternate;
  } else if (expr.operator === '&&') {
    // {cond && <A/>} — mount A when truthy, nothing otherwise
    pickExpr = t.conditionalExpression(
      t.cloneNode(expr.left),
      t.numericLiteral(0),
      t.numericLiteral(1),
    );
    thenNode = expr.right;
    elseNode = null;
  } else {
    // {cond || <A/>} — mount A when FALSY: swap the branch indexes
    pickExpr = t.conditionalExpression(
      t.cloneNode(expr.left),
      t.numericLiteral(1),
      t.numericLiteral(0),
    );
    thenNode = expr.right;
    elseNode = null;
  }

  const resolveBranch = (n: t.Node | null): t.JSXElement | null => {
    if (n === null || isEmptyBranch(n)) return null;
    if (t.isJSXElement(n)) return n;
    return fail(
      'memo-dom: conditional branches must be JSX elements or null/false — for text use an interpolation: {cond ? msgA : msgB}',
    );
  };

  const thenJsx = resolveBranch(thenNode);
  const elseJsx = resolveBranch(elseNode);
  if (thenJsx !== null) validateBranchJsx(thenJsx, fail);
  if (elseJsx !== null) validateBranchJsx(elseJsx, fail);

  const suffix = `when${usedConds.count++}`;
  return { pickExpr, thenJsx, elseJsx, suffix };
}

/**
 * conds.ts - conditional-site analysis.
 *
 * Direct JSX-child ternaries and logical conditions become anchored regions.
 * Right-associated ternary chains flatten into one multi-branch region.
 */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import type { JsxNode } from './jsx/children';
import { planConditionalBranches } from './jsx/conditional-plan';

interface ErrorPath {
  buildCodeFrameError(message: string, at?: t.Node): Error;
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

export function analyzeCondSite(
  expr: t.ConditionalExpression | t.LogicalExpression,
  errorAt: ErrorPath,
  usedConds: { count: number },
): CondSite {
  const plan = planConditionalBranches(expr, errorAt);
  return { pickExpr: plan.pickExpr, branches: [...plan.branches], suffix: `when${usedConds.count++}` };
}

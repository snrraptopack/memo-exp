/** Source region shapes prepared after shared lowering, before factory emission. */
import type * as t from '../ast/compiler-types';
import { walkAst } from '../ast';
import type { ComponentPath, MapCallExpression } from '../context/model';
import { containsJsx, matchMapCall } from '../lists';
import { planListCallback, type ListCallbackPlan } from '../lists/callback-plan';
import { matchCond } from '../conds';
import { planConditionalBranches, type ConditionalBranchPlan } from '../jsx/conditional-plan';

export interface ComponentRegionShapes {
  readonly listCallbackFor: (call: MapCallExpression) => ListCallbackPlan;
  readonly conditionalFor: (expression: t.ConditionalExpression | t.LogicalExpression) => ConditionalBranchPlan;
}

/**
 * Plans own one compilation's AST references. Newly cloned content uses the
 * same pure normalizer; it acquires no lexical optimization proof from a name.
 */
export function planComponentRegionShapes(path: ComponentPath): ComponentRegionShapes {
  const lists = new WeakMap<MapCallExpression, ListCallbackPlan>();
  const conditions = new WeakMap<t.Node, ConditionalBranchPlan>();
  const fail = (message: string, at?: t.Node): never => { throw path.buildCodeFrameError(message, at); };
  const listCallbackFor = (call: MapCallExpression): ListCallbackPlan => {
    let plan = lists.get(call);
    if (plan === undefined) {
      plan = planListCallback(call, fail);
      lists.set(call, plan);
      if (plan.jsx !== null) visit(plan.jsx);
    }
    return plan;
  };
  const conditionalFor = (expression: t.ConditionalExpression | t.LogicalExpression): ConditionalBranchPlan => {
    let plan = conditions.get(expression);
    if (plan === undefined) {
      plan = planConditionalBranches(expression, path);
      conditions.set(expression, plan);
      for (const branch of plan.branches) if (branch !== null) visit(branch);
    }
    return plan;
  };
  function visit(root: t.Node): void {
    walkAst<t.Node>(root, { enter(node) {
      const map = matchMapCall(node);
      if (map !== null && containsJsx(map)) { listCallbackFor(map); return false; }
      const condition = matchCond(node);
      if (condition !== null && containsJsx(condition)) { conditionalFor(condition); return false; }
    }});
  }
  visit(path.node);
  return { listCallbackFor, conditionalFor };
}

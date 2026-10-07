/** Source region shapes prepared after shared lowering, before factory emission. */
import type * as t from '../ast/compiler-types';
import { walkAst } from '../ast';
import type { ComponentPath, MapCallExpression } from '../context/model';
import { containsJsx, matchMapCall } from '../lists';
import { planListCallback, type ListCallbackPlan } from '../lists/callback-plan';
import { matchCond } from '../conds';
import { planConditionalBranches, type ConditionalBranchPlan } from '../jsx/conditional-plan';
import * as astFactory from '../ast/factory';
import { attrExpr } from '../context/ast';
import { planRenderCallback, type RenderCallbackPlan } from '../components/render-callbacks';
import { jsxAttributeName } from '../jsx/attributes';

export interface ComponentRegionShapes {
  readonly listCallbackFor: (call: MapCallExpression) => ListCallbackPlan;
  readonly conditionalFor: (expression: t.ConditionalExpression | t.LogicalExpression) => ConditionalBranchPlan;
  readonly renderCallbackFor: (expression: t.Expression) => RenderCallbackPlan;
}

/**
 * Plans own one compilation's AST references. Newly cloned content uses the
 * same pure normalizer; it acquires no lexical optimization proof from a name.
 */
export function planComponentRegionShapes(path: ComponentPath,
  callbackProps: ReadonlyMap<string, readonly string[]> = new Map()): ComponentRegionShapes {
  const lists = new WeakMap<MapCallExpression, ListCallbackPlan>();
  const conditions = new WeakMap<t.Node, ConditionalBranchPlan>();
  const callbacks = new WeakMap<t.Expression, RenderCallbackPlan>();
  const fail = (message: string, at?: t.Node): never => { throw path.buildCodeFrameError(message, at); };
  const renderCallbackFor = (expression: t.Expression): RenderCallbackPlan => {
    let plan = callbacks.get(expression);
    if (plan === undefined) {
      plan = planRenderCallback(expression, message => fail(message, expression));
      callbacks.set(expression, plan);
      visit(plan.jsx);
    }
    return plan;
  };
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
      // Normalized row content was already visited when its plan was captured.
      if ((astFactory.isArrowFunctionExpression(node) || astFactory.isFunctionExpression(node)) && callbacks.has(node)) return false;
      if (node.type === 'JSXOpeningElement' && astFactory.isJSXIdentifier((node as t.JSXOpeningElement).name)) {
        const opening = node as t.JSXOpeningElement;
        const names = callbackProps.get((opening.name as t.JSXIdentifier).name);
        if (names?.length) for (const attribute of opening.attributes) {
          if (astFactory.isJSXSpreadAttribute(attribute)) {
            if (astFactory.isObjectExpression(attribute.argument)) for (const property of attribute.argument.properties) {
              if (!astFactory.isObjectProperty(property) || property.computed || !astFactory.isExpression(property.value)) continue;
              const name = astFactory.isIdentifier(property.key) ? property.key.name : astFactory.isStringLiteral(property.key) ? property.key.value : null;
              if (name !== null && names.includes(name)) renderCallbackFor(property.value);
            }
          } else if (names.includes(jsxAttributeName(attribute.name))) {
            const value = attrExpr(attribute.value);
            if (value !== null) renderCallbackFor(value);
          }
        }
      }
      const map = matchMapCall(node);
      if (map !== null && containsJsx(map)) { listCallbackFor(map); return false; }
      const condition = matchCond(node);
      if (condition !== null && containsJsx(condition)) { conditionalFor(condition); return false; }
    }});
  }
  visit(path.node);
  return { listCallbackFor, conditionalFor, renderCallbackFor };
}

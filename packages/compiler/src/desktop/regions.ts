/** Desktop component choices consume the shared conditional normalization plan. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { planConditionalBranches } from '../jsx/conditional-plan';
import type { desktopComponentCall } from './component-call';

export function desktopRegionPlan(expression: t.ConditionalExpression | t.LogicalExpression, options: {
  call: (element: t.JSXElement) => ReturnType<typeof desktopComponentCall>;
  sourcesFor: (expression: t.Expression) => readonly string[] | null;
  fresh: (name: string) => t.Identifier;
  fail: (message: string, at: t.Node) => never;
}) {
  if (b.isLogicalExpression(expression) && expression.operator === '??') options.fail('nullish desktop component choices are not implemented; use an explicit null/undefined test in a ternary', expression);
  const plan = planConditionalBranches(expression, { buildCodeFrameError(message, at) { options.fail(message, at ?? expression); } });
  let sources = options.sourcesFor(plan.pickExpr);
  const choices = plan.branches.map(branch => {
    if (branch === null) return null;
    let child: t.Node = branch;
    if (b.isJSXFragment(child)) {
      const children = child.children.filter(child => !(b.isJSXText(child) && !child.value.trim()) && !(b.isJSXExpressionContainer(child) && b.isJSXEmptyExpression(child.expression)));
      if (children.length === 1) child = children[0]!;
    }
    if (!b.isJSXElement(child) || !b.isJSXIdentifier(child.openingElement.name) || !/^[A-Z]/.test(child.openingElement.name.name)) options.fail('conditional desktop branches currently require a named component or null/false; inline subtrees are not implemented yet', child);
    const call = options.call(child);
    sources = sources === null || call.sources === null ? null : [...new Set([...sources, ...call.sources])].sort();
    return call;
  });
  const selected = options.fresh('__desktopBranch');
  let result: t.Expression = b.objectExpression([
    b.objectProperty(b.identifier('branch'), b.numericLiteral(choices.length-1)),
    b.objectProperty(b.identifier('props'), choices.at(-1)?.props ?? b.objectExpression([])),
  ]);
  for (let index = choices.length-2; index >= 0; index--) result = b.conditionalExpression(
    b.binaryExpression('===', selected, b.numericLiteral(index)), b.objectExpression([
      b.objectProperty(b.identifier('branch'), b.numericLiteral(index)),
      b.objectProperty(b.identifier('props'), choices[index]?.props ?? b.objectExpression([])),
    ]), result,
  );
  return { sources, choices: choices.map(choice => choice?.component ?? b.nullLiteral()),
    read: b.arrowFunctionExpression([], b.blockStatement([
      b.variableDeclaration('const', [b.variableDeclarator(selected, plan.pickExpr)]), b.returnStatement(result),
    ])) };
}

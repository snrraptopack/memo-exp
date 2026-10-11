/** Desktop component choices consume the shared conditional normalization plan. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { planConditionalBranches } from '../jsx/conditional-plan';
import type { ConditionalBranchPlan } from '../jsx/conditional-plan';
import type { desktopComponentCall } from './component-call';

export function desktopRegionPlan(
  expression: t.ConditionalExpression | t.LogicalExpression,
  options: {
    call: (element: t.JSXElement) => ReturnType<typeof desktopComponentCall>;
    inline: (
      branch: t.JSXElement | t.JSXFragment,
      captures?: readonly t.Identifier[],
    ) => ReturnType<typeof desktopComponentCall>;
    sourcesFor: (expression: t.Expression) => readonly string[] | null;
    fresh: (name: string) => t.Identifier;
    fail: (message: string, at: t.Node) => never;
  },
) {
  if (b.isLogicalExpression(expression) && expression.operator === '??') {
    // The shared plan supplies branch order; capture the nullish value once
    // before selection because getters are observable.
    const value = options.fresh('__desktopNullish');
    const pick = b.conditionalExpression(
      b.binaryExpression('==', value, b.nullLiteral()),
      b.numericLiteral(0),
      b.numericLiteral(1),
    );
    const shared = planConditionalBranches(expression, {
      buildCodeFrameError: (message, at) => options.fail(message, at ?? expression),
    });
    // Capture the selected value into the inline fragment's existing scope ABI.
    // Falsy values (0 and '') remain visible and getters run once per read.
    const valueBranch = b.jsxFragment(b.jsxOpeningFragment(), b.jsxClosingFragment(), [
      b.jsxExpressionContainer(value),
    ]);
    return desktopBranchesPlan(
      { pickExpr: pick, branches: [shared.branches[0]!, valueBranch] },
      {
        ...options,
        inline: (branch) => options.inline(branch, branch === valueBranch ? [value] : []),
      },
      {
        prepare: [b.variableDeclaration('const', [b.variableDeclarator(value, expression.left)])],
        sources: options.sourcesFor(expression.left),
      },
    );
  }
  const plan = planConditionalBranches(expression, {
    buildCodeFrameError(message, at) {
      options.fail(message, at ?? expression);
    },
  });
  return desktopBranchesPlan(plan, options);
}

/** Early returns and authored JSX conditionals share the native region ABI. */
export function desktopBranchesPlan(
  plan: ConditionalBranchPlan,
  options: Parameters<typeof desktopRegionPlan>[1],
  preparation?: { prepare: readonly t.Statement[]; sources: readonly string[] | null },
) {
  let sources = preparation ? preparation.sources : options.sourcesFor(plan.pickExpr);
  const choices = plan.branches.map((branch) => {
    if (branch === null) return null;
    let child: t.Node = branch;
    if (b.isJSXFragment(child)) {
      const children = child.children.filter(
        (child) =>
          !(b.isJSXText(child) && !child.value.trim()) &&
          !(b.isJSXExpressionContainer(child) && b.isJSXEmptyExpression(child.expression)),
      );
      if (children.length === 1) child = children[0]!;
    }
    const namedComponent =
      b.isJSXElement(child) &&
      b.isJSXIdentifier(child.openingElement.name) &&
      /^[A-Z]/.test(child.openingElement.name.name);
    const call = namedComponent ? options.call(child as t.JSXElement) : options.inline(branch);
    sources =
      sources === null || call.sources === null
        ? null
        : [...new Set([...sources, ...call.sources])].sort();
    return call;
  });
  const selected = options.fresh('__desktopBranch');
  const selection = (index: number) =>
    b.objectExpression([
      b.objectProperty(b.identifier('branch'), b.numericLiteral(index)),
      b.objectProperty(b.identifier('props'), choices[index]?.props ?? b.objectExpression([])),
    ]);
  let result: t.Expression = selection(choices.length - 1);
  for (let index = choices.length - 2; index >= 0; index--) {
    result = b.conditionalExpression(
      b.binaryExpression('===', selected, b.numericLiteral(index)),
      selection(index),
      result,
    );
  }
  // Evaluate selection once; props and inline reads belong only to that branch.
  return {
    sources,
    choices: choices.map((choice) => choice?.component ?? b.nullLiteral()),
    read: b.arrowFunctionExpression(
      [],
      b.blockStatement([
        ...(preparation?.prepare ?? []),
        b.variableDeclaration('const', [b.variableDeclarator(selected, plan.pickExpr)]),
        b.returnStatement(result),
      ]),
    ),
  };
}

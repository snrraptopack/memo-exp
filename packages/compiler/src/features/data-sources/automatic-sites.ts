/** Automatic pending/error policy sites for transparent reads. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
  overwriteNode,
  type BaseNode,
} from '../../ast';
import type { Ctx } from '../../context';
import { mdd } from '../../identifiers';
import { annotateTransparentSources, sourceArray } from './subscriptions';

interface TransparentPolicyRenderer {
  renderer: t.Expression;
  args: t.Expression[];
}

type TransparentPolicyElement = t.JSXElement & {
  __memoDomTransparentPolicyRenderer?: TransparentPolicyRenderer;
};

function policyRendererElement(
  renderer: t.Expression,
  args: t.Expression[],
): t.JSXElement {
  const element = astFactory.jsxElement(
    astFactory.jsxOpeningElement(
      astFactory.jsxIdentifier('mmd-data-policy-render'),
      [],
      true,
    ),
    null,
    [],
  ) as TransparentPolicyElement;
  element.__memoDomTransparentPolicyRenderer = { renderer, args };
  return element;
}

export function transparentPolicyRenderer(
  element: t.JSXElement,
): TransparentPolicyRenderer | null {
  return (element as TransparentPolicyElement)
    .__memoDomTransparentPolicyRenderer ?? null;
}

function sourcePolicy(
  ctx: Ctx,
  component: string,
  source: string,
): t.Expression {
  const parameter = ctx.transparentPolicyParams.get(component);
  const prop = ctx.transparentSourceProps.get(component)?.get(source);
  if (parameter === undefined) return astFactory.nullLiteral();
  const fallback = astFactory.optionalMemberExpression(
    cloneEstreeNode(parameter),
    astFactory.identifier('$default'),
    false,
    true,
  );
  if (prop === undefined) return fallback;
  return astFactory.logicalExpression(
    '??',
    astFactory.optionalMemberExpression(
      cloneEstreeNode(parameter),
      isValidEstreeIdentifier(prop)
        ? astFactory.identifier(prop)
        : astFactory.stringLiteral(prop),
      !isValidEstreeIdentifier(prop),
      true,
    ),
    fallback,
  );
}

function policyForStatus(
  ctx: Ctx,
  component: string,
  dependencies: readonly string[],
  indexHelper: string,
): t.Expression {
  const policies = dependencies.map((source) =>
    sourcePolicy(ctx, component, source)
  );
  const selected = dependencies.length === 1
    ? policies[0]!
    : astFactory.memberExpression(
        astFactory.arrayExpression(policies),
        astFactory.callExpression(mdd(ctx, indexHelper), [sourceArray(dependencies)]),
        true,
      );
  return selected;
}

function policyMember(
  policy: t.Expression,
  name: 'pending' | 'error',
): t.Expression {
  return astFactory.optionalMemberExpression(
    cloneEstreeNode(policy),
    astFactory.identifier(name),
    false,
    true,
  );
}

function fragmentExpression(expression: t.Expression): t.JSXFragment {
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(expression)],
  );
}

export function wrapAutomaticSite(
  ctx: Ctx,
  component: string,
  expression: t.Expression,
  dependencies: readonly string[],
): void {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const pendingRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
      cloneEstreeNode(sources, true),
    ]);
  const errorPolicy = policyForStatus(
    ctx,
    component,
    dependencies,
    'resolvedValuesErrorIndex',
  );
  const pendingPolicy = policyForStatus(
    ctx,
    component,
    dependencies,
    'resolvedValuesPendingIndex',
  );
  const errorRenderer = policyMember(errorPolicy, 'error');
  const pendingRenderer = policyMember(pendingPolicy, 'pending');
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const conditional = astFactory.conditionalExpression(
    astFactory.logicalExpression('&&', errorRead(), cloneEstreeNode(errorRenderer)),
    policyRendererElement(cloneEstreeNode(errorRenderer), [errorRead(), retry]),
    astFactory.conditionalExpression(
      errorRead(),
      fragmentExpression(
        astFactory.callExpression(mdd(ctx, 'throwResolvedValuesError'), [
          cloneEstreeNode(sources, true),
        ]),
      ),
      astFactory.conditionalExpression(
        astFactory.logicalExpression('&&', pendingRead(), cloneEstreeNode(pendingRenderer)),
        policyRendererElement(cloneEstreeNode(pendingRenderer), []),
        astFactory.conditionalExpression(
          pendingRead(),
          astFactory.jsxFragment(astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), []),
          fragmentExpression(cloneEstreeNode(expression, true)),
        ),
      ),
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  overwriteNode(
    expression as unknown as BaseNode,
    conditional as unknown as BaseNode,
  );
}

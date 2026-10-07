/** Automatic pending/error policy sites for transparent reads. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
  overwriteNode,
  type BaseNode,
} from '../../ast';
import type { DomContext as Ctx } from '../../dom/context';
import type { TransparentPresentationPolicy, TransparentPresentationComponent } from '../../context';
import { md, mdd } from '../../dom/identifiers';
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
  if (astFactory.isJSXFragment(expression)) return expression;
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.isJSXElement(expression) ? expression : astFactory.jsxExpressionContainer(expression)],
  );
}

function authoredPolicyElement(
  policy: string | TransparentPresentationComponent,
  props: Array<{ name: string; value: t.Expression }> = [],
): t.JSXElement {
  const component = typeof policy === 'string' ? policy : policy.component;
  const entries = [
    ...props.map(prop => ({ ...prop, implicit: true })),
    ...(typeof policy === 'string' ? [] : policy.props.map(prop => ({ ...prop, implicit: false }))),
  ];
  return astFactory.jsxElement(astFactory.jsxOpeningElement(astFactory.jsxIdentifier(component),
    entries.map(({ name, value, implicit }) => {
      const attribute = astFactory.jsxAttribute(astFactory.jsxIdentifier(name),
        astFactory.jsxExpressionContainer(cloneEstreeNode(value, true))) as PolicyProp;
      attribute.__memoDomImplicitPolicyProp = implicit;
      return attribute;
    }), true), null, []);
}

type PolicyProp = t.JSXAttribute & { __memoDomImplicitPolicyProp?: boolean };
export function isImplicitPolicyProp(attribute: t.JSXAttribute): boolean {
  return (attribute as PolicyProp).__memoDomImplicitPolicyProp === true;
}

export function wrapAutomaticSite(
  ctx: Ctx,
  component: string,
  expression: t.Expression,
  dependencies: readonly string[],
  override?: TransparentPresentationPolicy,
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
  const presentationError = () => astFactory.callExpression(md(ctx, 'toPresentationError'), [
    errorRead(), astFactory.stringLiteral('request'),
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
  const errorRenderer = override?.error === undefined ? policyMember(errorPolicy, 'error')
    : astFactory.booleanLiteral(true);
  const pendingRenderer = override?.pending === undefined ? policyMember(pendingPolicy, 'pending')
    : astFactory.booleanLiteral(true);
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const conditional = astFactory.conditionalExpression(
    astFactory.logicalExpression('&&', errorRead(), cloneEstreeNode(errorRenderer)),
    override?.error === undefined
      ? policyRendererElement(cloneEstreeNode(errorRenderer), [presentationError(), retry])
      : authoredPolicyElement(override.error, [{ name: 'error', value: presentationError() }, { name: 'retry', value: retry }]),
    astFactory.conditionalExpression(
      errorRead(),
      fragmentExpression(
        astFactory.callExpression(mdd(ctx, 'throwResolvedValuesError'), [
          cloneEstreeNode(sources, true),
        ]),
      ),
      astFactory.conditionalExpression(
        astFactory.logicalExpression('&&', pendingRead(), cloneEstreeNode(pendingRenderer)),
        override?.pending === undefined ? policyRendererElement(cloneEstreeNode(pendingRenderer), [])
          : authoredPolicyElement(override.pending),
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

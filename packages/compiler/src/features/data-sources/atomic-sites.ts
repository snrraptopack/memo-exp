/** Atomic boundaries share conditional analysis/identity, not availability picks. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import type { TransparentPresentationPolicy } from '../../context';

type AtomicExpression = t.ConditionalExpression & {
  __memoDomAtomicPolicy?: TransparentPresentationPolicy;
};
type AtomicRoute = t.JSXElement & {
  __memoDomRouteAtomicPolicy?: TransparentPresentationPolicy;
};

export function markAtomicRoute(
  element: t.JSXElement,
  policy: TransparentPresentationPolicy = {},
): void {
  (element as AtomicRoute).__memoDomRouteAtomicPolicy = policy;
}

export function atomicRoutePolicy(element: t.JSXElement): TransparentPresentationPolicy | undefined {
  return (element as AtomicRoute).__memoDomRouteAtomicPolicy;
}

export function atomicSite(
  content: t.JSXElement | t.JSXFragment,
  policy: TransparentPresentationPolicy = {},
): t.JSXFragment {
  const expression = astFactory.conditionalExpression(astFactory.booleanLiteral(true), content,
    astFactory.jsxFragment(astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), [])) as AtomicExpression;
  expression.__memoDomAtomicPolicy = policy;
  return astFactory.jsxFragment(astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(expression)]);
}

export function atomicSitePolicy(expression: t.Expression): TransparentPresentationPolicy | undefined {
  return (expression as AtomicExpression).__memoDomAtomicPolicy;
}

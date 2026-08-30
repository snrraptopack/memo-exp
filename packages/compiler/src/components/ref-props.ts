/**
 * components/ref-props.ts - discover ref adapters crossing component APIs.
 *
 * A prop becomes a ref prop only when the receiving component authors it in
 * `ref={...}`. Callers can then turn assignable JSX sinks into callbacks
 * before the ordinary props ABI reads their values.
 */

import {
  isArrayExpression,
  isJSXAttribute,
  isJSXExpressionContainer,
  isJSXIdentifier,
  walkAst,
  type BaseNode,
} from '../ast';
import type { Ctx } from '../context';
import { renderPropReferenceName } from './children';

/** Mark every declared prop that a component forwards into a JSX ref slot. */
export function scanRefProps(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const plan = ctx.componentProps.get(name)!;
    walkAst(componentPath.node as unknown as BaseNode, {
      enter(node) {
        if (!isJSXAttribute(node)) return;
        if (!isJSXIdentifier(node.name) || node.name.name !== 'ref') return;
        if (!isJSXExpressionContainer(node.value)) return;
        const expression = node.value.expression;
        if (expression.type === 'JSXEmptyExpression') return;
        for (const prop of referencedRefProps(ctx, name, expression)) {
          if (!plan.refProps.includes(prop)) plan.refProps.push(prop);
        }
      },
    });
  }
}

function referencedRefProps(
  ctx: Ctx,
  componentName: string,
  expression: BaseNode,
): string[] {
  const direct = renderPropReferenceName(ctx, componentName, expression);
  if (direct !== null) return [direct];
  if (!isArrayExpression(expression)) return [];

  const props: string[] = [];
  for (const element of expression.elements) {
    if (element === null || element.type === 'SpreadElement') continue;
    props.push(...referencedRefProps(ctx, componentName, element));
  }
  return props;
}

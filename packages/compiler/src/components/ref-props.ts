/**
 * components/ref-props.ts - discover ref adapters crossing component APIs.
 *
 * A prop becomes a ref prop only when the receiving component authors it in
 * `ref={...}`. Callers can then turn assignable JSX sinks into callbacks
 * before the ordinary props ABI reads their values.
 */

import * as t from '@babel/types';
import type { Ctx } from '../context';
import { jsxAttributeName } from '../jsx/attributes';
import { renderPropReferenceName } from './children';

/** Mark every declared prop that a component forwards into a JSX ref slot. */
export function scanRefProps(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const plan = ctx.componentProps.get(name)!;
    componentPath.traverse({
      JSXAttribute(path) {
        if (jsxAttributeName(path.node.name) !== 'ref') return;
        const value = path.node.value;
        if (
          !t.isJSXExpressionContainer(value) ||
          !t.isExpression(value.expression)
        ) {
          return;
        }
        for (const prop of referencedRefProps(ctx, name, value.expression)) {
          if (!plan.refProps.includes(prop)) plan.refProps.push(prop);
        }
      },
    });
  }
}

function referencedRefProps(
  ctx: Ctx,
  componentName: string,
  expression: t.Expression,
): string[] {
  const direct = renderPropReferenceName(ctx, componentName, expression);
  if (direct !== null) return [direct];
  if (!t.isArrayExpression(expression)) return [];

  const props: string[] = [];
  for (const element of expression.elements) {
    if (element === null || t.isSpreadElement(element)) continue;
    props.push(...referencedRefProps(ctx, componentName, element));
  }
  return props;
}

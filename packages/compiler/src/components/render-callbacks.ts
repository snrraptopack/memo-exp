import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Ctx } from '../context';
import {
  localBindingForProp,
  objectBindingName,
  propNameForBinding,
} from './props';

export interface RenderCallbackInvocation {
  propName: string;
  target: t.Expression;
  arguments: t.Expression[];
}

/** Is this JSX element the returned root of a declared callback prop value? */
export function isRenderCallbackJsxRoot(
  ctx: Ctx,
  element: NodePath<t.JSXElement>,
): boolean {
  const fn = element.findParent(
    (parent) =>
      parent.isArrowFunctionExpression() || parent.isFunctionExpression(),
  );
  if (
    fn === null ||
    (!fn.isArrowFunctionExpression() && !fn.isFunctionExpression())
  ) {
    return false;
  }
  const body = fn.get('body');
  const returnedRoot =
    (body.isJSXElement() && body.node === element.node) ||
    (body.isBlockStatement() &&
      body.node.body.length === 1 &&
      t.isReturnStatement(body.node.body[0]) &&
      body.node.body[0].argument === element.node);
  if (!returnedRoot) return false;
  const container = fn.parentPath;
  const attribute = container?.parentPath;
  const opening = attribute?.parentPath;
  if (
    !container?.isJSXExpressionContainer() ||
    !attribute?.isJSXAttribute() ||
    !opening?.isJSXOpeningElement() ||
    !t.isJSXIdentifier(opening.node.name)
  ) {
    return false;
  }
  const attributeName = t.isJSXIdentifier(attribute.node.name)
    ? attribute.node.name.name
    : attribute.node.name.name.name;
  return (
    ctx.componentProps
      .get(opening.node.name.name)
      ?.renderCallbacks.includes(attributeName) === true ||
    // Linker discovery passes intentionally begin with incomplete imported
    // contracts. Let the later component-prop validation own the diagnostic;
    // this root-level key is valid if the fixed point resolves it as a
    // structural callback and otherwise the JSX prop is rejected normally.
    /^[A-Z]/.test(opening.node.name.name)
  );
}

function isMapCall(call: t.CallExpression): boolean {
  return (
    t.isMemberExpression(call.callee) &&
    !call.callee.computed &&
    t.isIdentifier(call.callee.property, { name: 'map' })
  );
}

function propReferenceName(
  ctx: Ctx,
  componentName: string,
  expression: t.Expression,
): string | null {
  const plan = ctx.componentProps.get(componentName);
  if (plan === undefined) return null;
  const objectBinding = objectBindingName(plan);
  if (
    objectBinding !== null &&
    t.isMemberExpression(expression) &&
    !expression.computed &&
    t.isIdentifier(expression.object, { name: objectBinding }) &&
    t.isIdentifier(expression.property)
  ) {
    return expression.property.name;
  }
  if (t.isIdentifier(expression)) {
    return (
      propNameForBinding(plan, expression.name) ??
      (localBindingForProp(plan, expression.name) !== null
        ? expression.name
        : null)
    );
  }
  return null;
}

function returnedExpression(
  callback: t.ArrowFunctionExpression,
): t.Expression | null {
  if (t.isExpression(callback.body)) return callback.body;
  if (
    callback.body.body.length === 1 &&
    t.isReturnStatement(callback.body.body[0]) &&
    t.isExpression(callback.body.body[0].argument)
  ) {
    return callback.body.body[0].argument;
  }
  return null;
}

/** Match `items.map((item, index) => renderItem(item, index))`. */
export function matchRenderCallbackMap(
  ctx: Ctx,
  componentName: string,
  call: t.CallExpression,
): RenderCallbackInvocation | null {
  if (!isMapCall(call) || call.arguments.length !== 1) return null;
  const callback = call.arguments[0];
  if (!t.isArrowFunctionExpression(callback)) return null;
  const returned = returnedExpression(callback);
  if (
    returned === null ||
    !t.isCallExpression(returned) ||
    !t.isExpression(returned.callee) ||
    returned.arguments.some(
      (argument) => !t.isExpression(argument),
    )
  ) {
    return null;
  }
  const propName = propReferenceName(
    ctx,
    componentName,
    returned.callee,
  );
  if (propName === null) return null;
  return {
    propName,
    target: t.cloneNode(returned.callee, true),
    arguments: returned.arguments.map((argument) =>
      t.cloneNode(argument as t.Expression, true),
    ),
  };
}

/**
 * Discover structural callback props before map-site analysis. No callback
 * method names or runtime JSX values are involved: the callee declares the
 * contract by directly returning a prop invocation from a structural map.
 */
export function scanRenderCallbacks(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const plan = ctx.componentProps.get(componentName)!;
    componentPath.traverse({
      CallExpression(path: NodePath<t.CallExpression>) {
        const invocation = matchRenderCallbackMap(
          ctx,
          componentName,
          path.node,
        );
        if (
          invocation !== null &&
          !plan.renderCallbacks.includes(invocation.propName)
        ) {
          plan.renderCallbacks.push(invocation.propName);
        }
      },
    });
  }
}

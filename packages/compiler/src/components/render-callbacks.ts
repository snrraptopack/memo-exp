import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { walkAst, type BaseNode } from '../ast';
import type { Ctx, MapCallExpression } from '../context';
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

interface NodeHolder {
  node: BaseNode;
}

function field(node: BaseNode, name: string): unknown {
  return (node as unknown as Record<string, unknown>)[name];
}

function isNode(value: unknown): value is BaseNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function childNode(node: BaseNode, name: string): BaseNode | null {
  const value = field(node, name);
  return isNode(value) ? value : null;
}

function childNodes(node: BaseNode, name: string): BaseNode[] {
  const value = field(node, name);
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/** Is this JSX element the returned root of a declared callback prop value? */
export function isRenderCallbackJsxRoot(
  ctx: Ctx,
  input: BaseNode | NodeHolder,
): boolean {
  const element = 'node' in input ? input.node : input;
  let fn = ctx.astAnalysis?.parentByNode.get(element) ?? null;
  while (
    fn !== null &&
    fn.type !== 'ArrowFunctionExpression' &&
    fn.type !== 'FunctionExpression'
  ) {
    fn = ctx.astAnalysis?.parentByNode.get(fn) ?? null;
  }
  if (fn === null) return false;
  const body = childNode(fn, 'body');
  if (body === null) return false;
  const returnedRoot =
    (body.type === 'JSXElement' && body === element) ||
    (body.type === 'BlockStatement' &&
      childNodes(body, 'body').length === 1 &&
      childNodes(body, 'body')[0]?.type === 'ReturnStatement' &&
      childNode(childNodes(body, 'body')[0]!, 'argument') === element);
  if (!returnedRoot) return false;
  const container = ctx.astAnalysis?.parentByNode.get(fn) ?? null;
  const attribute =
    container === null
      ? null
      : ctx.astAnalysis?.parentByNode.get(container) ?? null;
  const opening =
    attribute === null
      ? null
      : ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (
    container?.type !== 'JSXExpressionContainer' ||
    attribute?.type !== 'JSXAttribute' ||
    opening?.type !== 'JSXOpeningElement'
  ) {
    return false;
  }
  const openingName = childNode(opening, 'name');
  const attributeNameNode = childNode(attribute, 'name');
  if (openingName?.type !== 'JSXIdentifier' || attributeNameNode === null) {
    return false;
  }
  const tagName = field(openingName, 'name');
  const attributeName =
    attributeNameNode.type === 'JSXIdentifier'
      ? field(attributeNameNode, 'name')
      : field(childNode(attributeNameNode, 'name') ?? attributeNameNode, 'name');
  if (typeof tagName !== 'string' || typeof attributeName !== 'string') {
    return false;
  }
  return (
    ctx.componentProps
      .get(tagName)
      ?.renderCallbacks.includes(attributeName) === true ||
    // Linker discovery passes intentionally begin with incomplete imported
    // contracts. Let the later component-prop validation own the diagnostic;
    // this root-level key is valid if the fixed point resolves it as a
    // structural callback and otherwise the JSX prop is rejected normally.
    /^[A-Z]/.test(tagName)
  );
}

function isMapCall(call: MapCallExpression): boolean {
  return (
    (astFactory.isMemberExpression(call.callee) ||
      astFactory.isOptionalMemberExpression(call.callee)) &&
    !call.callee.computed &&
    astFactory.isIdentifier(call.callee.property, { name: 'map' })
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
    astFactory.isMemberExpression(expression) &&
    !expression.computed &&
    astFactory.isIdentifier(expression.object, { name: objectBinding }) &&
    astFactory.isIdentifier(expression.property)
  ) {
    return expression.property.name;
  }
  if (astFactory.isIdentifier(expression)) {
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
  if (astFactory.isExpression(callback.body)) return callback.body;
  if (
    callback.body.body.length === 1 &&
    astFactory.isReturnStatement(callback.body.body[0]) &&
    astFactory.isExpression(callback.body.body[0].argument)
  ) {
    return callback.body.body[0].argument;
  }
  return null;
}

/** Match `items.map((item, index) => renderItem(item, index))`. */
export function matchRenderCallbackMap(
  ctx: Ctx,
  componentName: string,
  call: MapCallExpression,
): RenderCallbackInvocation | null {
  if (!isMapCall(call) || call.arguments.length !== 1) return null;
  const callback = call.arguments[0];
  if (!astFactory.isArrowFunctionExpression(callback)) return null;
  const returned = returnedExpression(callback);
  if (
    returned === null ||
    !astFactory.isCallExpression(returned) ||
    !astFactory.isExpression(returned.callee) ||
    returned.arguments.some(
      (argument) => !astFactory.isExpression(argument),
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
    target: cloneEstreeNode(returned.callee, true),
    arguments: returned.arguments.map((argument) =>
      cloneEstreeNode(argument as t.Expression, true),
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
    walkAst<BaseNode>(componentPath.node, {
      enter(node) {
        if (
          node.type !== 'CallExpression' &&
          node.type !== 'OptionalCallExpression'
        ) {
          return;
        }
      const invocation = matchRenderCallbackMap(
        ctx,
        componentName,
          node as unknown as MapCallExpression,
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

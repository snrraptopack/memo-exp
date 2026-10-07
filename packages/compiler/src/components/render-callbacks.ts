import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  childNodes,
  cloneNode as cloneEstreeNode,
  extractPatternIdentifiers,
  nodeField as field,
  walkAst,
  type BaseNode,
} from '../ast';
import type { Ctx, MapCallExpression } from '../context';
import { attrExpr, keyPathOf } from '../context/ast';
import { cloneRuntimeBindingPattern } from '../analysis/runtime-pattern';
import {matchMapCall} from '../lists/source-shapes';
import {
  localBindingForProp,
  objectBindingName,
  propNameForBinding,
  type ComponentPropsPlan,
} from './props';

export interface RenderCallbackInvocation {
  propName: string;
  target: t.Expression;
  arguments: t.Expression[];
}

/** Authored callback syntax and row identity, without a renderer ABI. */
export interface RenderCallbackPlan {
  readonly jsx: t.JSXElement;
  readonly itemPattern: t.Identifier | t.ObjectPattern | t.ArrayPattern;
  readonly itemParam: string;
  readonly indexParam: string | null;
  readonly keyExpression: t.Expression | null;
  readonly keyPath: readonly string[] | null;
}

/** Normalize a callback on clones; planning never removes authored keys. */
export function planRenderCallback(source: t.Expression, fail: (message: string) => never): RenderCallbackPlan {
  if ((!astFactory.isArrowFunctionExpression(source) && !astFactory.isFunctionExpression(source)) || source.async || source.generator) {
    return fail('memo-dom: render callbacks must be synchronous inline arrows or function expressions');
  }
  const body = source.body;
  const returned = astFactory.isJSXElement(body) ? body :
    astFactory.isBlockStatement(body) && body.body.length === 1 && astFactory.isReturnStatement(body.body[0]) &&
      astFactory.isJSXElement(body.body[0].argument) ? body.body[0].argument : null;
  const first = source.params[0], second = source.params[1];
  if (returned === null || source.params.length < 1 || source.params.length > 2 ||
      (!astFactory.isIdentifier(first) && !astFactory.isObjectPattern(first) && !astFactory.isArrayPattern(first)) ||
      (second !== undefined && !astFactory.isIdentifier(second))) {
    return fail('memo-dom: render callbacks take an item binding pattern and optional index, then return one JSX element');
  }
  const itemPattern = cloneRuntimeBindingPattern(first);
  const bindings = extractPatternIdentifiers(itemPattern as unknown as BaseNode);
  if (!bindings.length) return fail('memo-dom: render callback item patterns must bind at least one name');
  const itemParam = astFactory.isIdentifier(itemPattern) ? itemPattern.name : bindings[0]!.name;
  const jsx = cloneEstreeNode(returned);
  let keyExpression: t.Expression | null = null;
  jsx.openingElement.attributes = jsx.openingElement.attributes.filter(attribute => {
    if (astFactory.isJSXSpreadAttribute(attribute) || !astFactory.isJSXIdentifier(attribute.name) || attribute.name.name !== 'key') return true;
    keyExpression = attrExpr(attribute.value);
    if (keyExpression === null) return fail('memo-dom: key={...} needs an expression');
    return false;
  });
  return {jsx,itemPattern,itemParam,indexParam:second?.name ?? null,keyExpression,keyPath:keyPathOf(keyExpression,itemParam)};
}

interface NodeHolder {
  node: BaseNode;
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

/** Captured prop references shared by structural callback analysis and planning. */
export interface RenderCallbackProps {
  readonly objectBinding: string | null;
  readonly bindingProps: ReadonlyMap<string, string>;
}
export function captureRenderCallbackProps(plan: ComponentPropsPlan | undefined): RenderCallbackProps {
  const bindingProps = new Map<string, string>();
  if (plan !== undefined) for (const binding of new Set([...plan.bindings, ...plan.names])) {
    const name = propNameForBinding(plan, binding) ??
      (localBindingForProp(plan, binding) !== null ? binding : null);
    if (name !== null) bindingProps.set(binding, name);
  }
  return {objectBinding: plan === undefined ? null : objectBindingName(plan), bindingProps};
}
function propReferenceName(props: RenderCallbackProps, expression: t.Expression): string | null {
  if (props.objectBinding !== null && astFactory.isMemberExpression(expression) && !expression.computed &&
    astFactory.isIdentifier(expression.object, {name: props.objectBinding}) && astFactory.isIdentifier(expression.property)) {
    return expression.property.name;
  }
  return astFactory.isIdentifier(expression) ? props.bindingProps.get(expression.name) ?? null : null;
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

/** Context adapter used while discovering authored composition contracts. */
export function matchRenderCallbackMap(
  ctx: Ctx, componentName: string, call: MapCallExpression,
): RenderCallbackInvocation | null {
  return planRenderCallbackMap(captureRenderCallbackProps(ctx.componentProps.get(componentName)), call);
}

/** Match a structural prop invocation using captured composition facts. */
export function planRenderCallbackMap(
  props: RenderCallbackProps, call: MapCallExpression,
): RenderCallbackInvocation | null {
  if (matchMapCall(call) === null || call.arguments.length !== 1) return null;
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
  const propName = propReferenceName(props, returned.callee);
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

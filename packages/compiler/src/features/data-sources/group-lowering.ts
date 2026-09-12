/**
 * Group and TSRX lowering for compiler-transparent async data sources.
 *
 * The public binding is typed as ResolvedValue<T>, while generated code keeps
 * the library's source holder. Reads are lowered either to a render gate or an
 * imperative resolution guard; source transitions push the owning component
 * through the ordinary runtime dirty queue.
 */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { cloneNode as cloneEstreeNode } from '../../ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  type Ctx,
  type TransparentPresentationComponent,
  type TransparentPresentationPolicy,
} from '../../context';
import {
  analyzeScope,
  childNode,
  isReferenceIdentifier,
  nodeFields as fields,
  replaceNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import {
  generatedComponentIdentifier,
  generatedIdentifier,
  mdd,
} from '../../identifiers';
import {
  annotateGroupComponentCalls,
  componentSourceProps,
  expressionOrigins,
  groupOrigins,
  inferredGroupDataNames,
  isLoweredGroupExpression,
  jsxTagName,
  type ComponentSourceProp,
} from './group-analysis';
import {
  annotateTransparentSources,
  sourceArray,
} from './subscriptions';

function meaningfulGroupChildren(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): Array<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer> {
  return element.children.filter((child): child is
    t.JSXElement | t.JSXFragment | t.JSXExpressionContainer => {
    if (astFactory.isJSXText(child)) {
      if (child.value.trim() !== '') {
        throw errorAt.buildCodeFrameError(
          'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
          child,
        );
      }
      return false;
    }
    if (
      astFactory.isJSXExpressionContainer(child) &&
      astFactory.isJSXEmptyExpression(child.expression)
    ) {
      return false;
    }
    return astFactory.isJSXElement(child) ||
      astFactory.isJSXFragment(child) ||
      astFactory.isJSXExpressionContainer(child);
  });
}

function componentPolicy(
  ctx: Ctx,
  element: t.JSXElement,
  expected: ReadonlySet<string>,
  label: string,
  kind: 'pending' | 'error',
  generatedPolicies: t.FunctionDeclaration[],
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): string | TransparentPresentationComponent {
  const tag = jsxTagName(element);
  if (tag === null || !expected.has(tag)) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: Group child must be <${label} component={...} />`,
      element,
    );
  }
  const attributes = element.openingElement.attributes;
  if (attributes.length !== 1 || !astFactory.isJSXAttribute(attributes[0])) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: <${label}> requires exactly one component prop`,
      element.openingElement,
    );
  }
  const attribute = attributes[0];
  const name = astFactory.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : null;
  const value = attribute.value;
  if (name !== 'component' || !astFactory.isJSXExpressionContainer(value)) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: <${label}> component must be a component identifier or inline render callback`,
      attribute,
    );
  }
  const expression = value.expression;
  if (astFactory.isIdentifier(expression)) return expression.name;
  if (
    !astFactory.isArrowFunctionExpression(expression) &&
    !astFactory.isFunctionExpression(expression)
  ) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: <${label}> component must be a component identifier or inline render callback`,
      expression,
    );
  }
  if (expression.async || expression.generator) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: <${label}> render callbacks must be synchronous`,
      expression,
    );
  }
  if (expression.params.length > 1) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: <${label}> render callbacks accept at most one props parameter`,
      expression,
    );
  }
  const parameter = expression.params[0];
  if (kind === 'pending' && parameter !== undefined) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: <Pending> render callbacks do not receive props',
      parameter,
    );
  }
  if (
    kind === 'error' &&
    parameter !== undefined &&
    !astFactory.isObjectPattern(parameter)
  ) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: <Error> render callbacks receive one destructured { error, retry } props object',
      parameter,
    );
  }
  const captures = tsrxPolicyCaptures(
    ctx,
    element as unknown as BaseNode,
    expression as unknown as BaseNode,
    new Set(),
  );
  const props: Array<{ prop: string; local: t.Identifier }> = [];
  if (kind === 'error') {
    const policyLocal = (name: 'error' | 'retry'): t.Identifier => {
      if (astFactory.isObjectPattern(parameter)) {
        for (const property of parameter.properties) {
          if (
            astFactory.isObjectProperty(property) &&
            !property.computed &&
            astFactory.isIdentifier(property.key, { name }) &&
            astFactory.isIdentifier(property.value)
          ) {
            return cloneEstreeNode(property.value);
          }
        }
      }
      return generatedIdentifier(ctx, name === 'error' ? 'groupError' : 'groupRetry');
    };
    const error = policyLocal('error');
    const retry = policyLocal('retry');
    props.push({ prop: 'error', local: error });
    props.push({ prop: 'retry', local: retry });
  }
  for (const capture of captures) {
    props.push({
      prop: capture.prop,
      local: astFactory.identifier(capture.binding.name),
    });
  }
  const component = generatedComponentIdentifier(
    ctx,
    kind === 'pending' ? 'GroupPending' : 'GroupError',
  );
  const callbackBody: t.Statement[] = [];
  if (astFactory.isBlockStatement(expression.body)) {
    callbackBody.push(
      ...expression.body.body.map((statement) => cloneEstreeNode(statement, true)),
    );
  } else {
    callbackBody.push(
      astFactory.returnStatement(cloneEstreeNode(expression.body, true)),
    );
  }
  generatedPolicies.push(
    astFactory.functionDeclaration(
      cloneEstreeNode(component),
      props.length === 0 ? [] : [objectBindingPattern(props)],
      astFactory.blockStatement(callbackBody),
    ),
  );
  return {
    component: component.name,
    props: captures.map((capture) => ({
      name: capture.prop,
      value: astFactory.identifier(capture.binding.name),
    })),
  };
}

function suspendDirective(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXAttribute | null {
  const attribute = element.openingElement.attributes.find(
    (candidate) =>
      astFactory.isJSXAttribute(candidate) &&
      astFactory.isJSXIdentifier(candidate.name, { name: 'suspend' }),
  );
  if (!astFactory.isJSXAttribute(attribute)) return null;
  if (attribute.value !== null) {
    throw errorAt.buildCodeFrameError(
      "memo-dom: suspend is a shorthand compiler directive; write 'suspend' without a value",
      attribute,
    );
  }
  return attribute;
}

function consumeSuspendDirective(
  element: t.JSXElement,
  attribute: t.JSXAttribute,
): void {
  const index = element.openingElement.attributes.indexOf(attribute);
  if (index !== -1) element.openingElement.attributes.splice(index, 1);
}

interface TsrxTryHandlerMetadata {
  param: BaseNode | null;
  resetParam: BaseNode | null;
  output: BaseNode;
}

interface TsrxTryMetadata {
  pending: BaseNode | null;
  handler: TsrxTryHandlerMetadata | null;
}

function tsrxTryMetadata(node: BaseNode): TsrxTryMetadata | null {
  const value = fields(node).__memoDomTsrxTry;
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pending = record.pending;
  const handler = record.handler;
  if (pending !== null && !astFactory.isNode(pending)) return null;
  if (handler !== null && (typeof handler !== 'object')) return null;
  if (handler === null) return { pending: pending as BaseNode | null, handler: null };
  const handlerRecord = handler as Record<string, unknown>;
  if (!astFactory.isNode(handlerRecord.output)) return null;
  return {
    pending: pending as BaseNode | null,
    handler: {
      param: astFactory.isNode(handlerRecord.param)
        ? handlerRecord.param as BaseNode
        : null,
      resetParam: astFactory.isNode(handlerRecord.resetParam)
        ? handlerRecord.resetParam as BaseNode
        : null,
      output: handlerRecord.output as BaseNode,
    },
  };
}

function policyElement(name: string, attributes: t.JSXAttribute[]): t.JSXElement {
  return astFactory.jsxElement(
    astFactory.jsxOpeningElement(astFactory.jsxIdentifier(name), attributes, true),
    null,
    [],
  );
}

function groupPolicyElement(
  policy: string | TransparentPresentationComponent,
  attributes: t.JSXAttribute[],
): t.JSXElement {
  if (typeof policy === 'string') return policyElement(policy, attributes);
  return policyElement(policy.component, [
    ...attributes,
    ...policy.props.map(({ name, value }) =>
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier(name),
        astFactory.jsxExpressionContainer(cloneEstreeNode(value, true)),
      )
    ),
  ]);
}

function wrapGroupSite(
  ctx: Ctx,
  expression: t.Expression,
  dependencies: readonly string[],
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): void {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const committed = astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(cloneEstreeNode(expression, true))],
  );
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    groupPolicyElement(error, [
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('error'),
        astFactory.jsxExpressionContainer(errorRead()),
      ),
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('retry'),
        astFactory.jsxExpressionContainer(retry),
      ),
    ]),
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      groupPolicyElement(pending, []),
      committed,
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  replaceNode(
    ctx.astAnalysis!,
    expression as unknown as BaseNode,
    conditional as unknown as BaseNode,
  );
}

function suspendedGroupOutput(
  ctx: Ctx,
  content: t.JSXElement,
  dependencies: readonly string[],
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): t.JSXFragment {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const committed = astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [cloneEstreeNode(content, true)],
  );
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    groupPolicyElement(error, [
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('error'),
        astFactory.jsxExpressionContainer(errorRead()),
      ),
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('retry'),
        astFactory.jsxExpressionContainer(retry),
      ),
    ]),
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      groupPolicyElement(pending, []),
      committed,
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(conditional)],
  );
}

function renderOutputFragment(output: BaseNode): t.JSXFragment {
  const child = cloneEstreeNode(output, true) as unknown as t.Expression;
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)
      ? [child]
      : [astFactory.jsxExpressionContainer(child)],
  );
}

function handlerOutput(
  metadata: TsrxTryHandlerMetadata,
  error: t.Expression,
  reset: t.Expression,
  programPath: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXFragment {
  const params: t.Identifier[] = [];
  const args: t.Expression[] = [];
  if (metadata.param !== null) {
    if (!astFactory.isIdentifier(metadata.param as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier error parameter',
        metadata.param as unknown as t.Node,
      );
    }
    params.push(cloneEstreeNode(metadata.param as unknown as t.Identifier));
    args.push(cloneEstreeNode(error));
  }
  if (metadata.resetParam !== null) {
    if (!astFactory.isIdentifier(metadata.resetParam as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier reset parameter',
        metadata.resetParam as unknown as t.Node,
      );
    }
    params.push(cloneEstreeNode(metadata.resetParam as unknown as t.Identifier));
    args.push(cloneEstreeNode(reset));
  }
  const output = cloneEstreeNode(metadata.output, true) as unknown as t.Expression;
  const call = astFactory.callExpression(
    astFactory.arrowFunctionExpression(params, output),
    args,
  );
  return renderOutputFragment(call as unknown as BaseNode);
}

function suspendedTsrxTryOutput(
  ctx: Ctx,
  component: t.JSXElement,
  dependencies: readonly string[],
  metadata: TsrxTryMetadata,
  programPath: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXFragment {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const reset = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const errorOutput = metadata.handler === null
    ? renderOutputFragment(
        astFactory.callExpression(mdd(ctx, 'throwResolvedValuesError'), [
          cloneEstreeNode(sources, true),
        ]) as unknown as BaseNode,
      )
    : handlerOutput(
        metadata.handler,
        errorRead(),
        reset,
        programPath,
      );
  const pendingOutput = metadata.pending === null
    ? astFactory.jsxFragment(
        astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(),
        [],
      )
    : renderOutputFragment(metadata.pending);
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    errorOutput,
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      pendingOutput,
      renderOutputFragment(component as unknown as BaseNode),
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(conditional)],
  );
}

interface TsrxPolicyCapture {
  binding: AstBinding;
  prop: string;
}

function tsrxPolicyCaptures(
  ctx: Ctx,
  boundary: BaseNode,
  output: BaseNode,
  excluded: ReadonlySet<string>,
): TsrxPolicyCapture[] {
  const local = analyzeScope(output);
  const captures = new Map<AstBinding, TsrxPolicyCapture>();
  walkAst(output, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const identifier = node as unknown as AstIdentifier;
      const parent = local.parentByNode.get(node) ?? null;
      const key = local.keyByNode.get(node);
      if (!isReferenceIdentifier(parent, key)) return;
      if (local.nodeToScope.get(node)?.getBinding(identifier.name) !== undefined) {
        return;
      }
      if (excluded.has(identifier.name)) return;
      const binding = astBindingAt(ctx, boundary, identifier.name);
      if (
        binding === undefined ||
        binding.scope.isProgramScope ||
        captures.has(binding)
      ) {
        return;
      }
      captures.set(binding, {
        binding,
        prop: `capture${captures.size}`,
      });
    },
  });
  return [...captures.values()];
}

function objectBindingPattern(
  entries: ReadonlyArray<{ prop: string; local: t.Identifier }>,
): t.ObjectPattern {
  return {
    type: 'ObjectPattern',
    properties: entries.map(({ prop, local }) =>
      astFactory.objectProperty(
        astFactory.identifier(prop),
        cloneEstreeNode(local),
        false,
        prop === local.name,
      )
    ),
  } as unknown as t.ObjectPattern;
}

function tsrxPolicyComponent(
  ctx: Ctx,
  boundary: BaseNode,
  output: BaseNode,
  kind: 'pending' | 'error',
  handler: TsrxTryHandlerMetadata | null,
): {
  declaration: t.FunctionDeclaration;
  renderer: TransparentPresentationComponent;
} {
  const excluded = new Set<string>();
  if (
    handler?.param !== null &&
    handler?.param !== undefined &&
    handler.param.type === 'Identifier'
  ) {
    excluded.add((handler.param as unknown as AstIdentifier).name);
  }
  if (
    handler?.resetParam !== null &&
    handler?.resetParam !== undefined &&
    handler.resetParam.type === 'Identifier'
  ) {
    excluded.add((handler.resetParam as unknown as AstIdentifier).name);
  }
  const captures = tsrxPolicyCaptures(ctx, boundary, output, excluded);
  const params: Array<{ prop: string; local: t.Identifier }> = [];
  if (kind === 'error') {
    const error = handler?.param === null || handler?.param === undefined
      ? generatedIdentifier(ctx, 'tsrxError')
      : cloneEstreeNode(handler.param as unknown as t.Identifier);
    const retry = handler?.resetParam === null || handler?.resetParam === undefined
      ? generatedIdentifier(ctx, 'tsrxReset')
      : cloneEstreeNode(handler.resetParam as unknown as t.Identifier);
    params.push({ prop: 'error', local: error });
    params.push({ prop: 'retry', local: retry });
  }
  for (const capture of captures) {
    params.push({
      prop: capture.prop,
      local: astFactory.identifier(capture.binding.name),
    });
  }
  const name = generatedComponentIdentifier(
    ctx,
    kind === 'pending' ? 'TsrxPending' : 'TsrxCatch',
  );
  const declaration = astFactory.functionDeclaration(
    cloneEstreeNode(name),
    params.length === 0 ? [] : [objectBindingPattern(params)],
    astFactory.blockStatement([
      astFactory.returnStatement(
        cloneEstreeNode(output, true) as unknown as t.Expression,
      ),
    ]),
  );
  return {
    declaration,
    renderer: {
      component: name.name,
      props: captures.map((capture) => ({
        name: capture.prop,
        value: astFactory.identifier(capture.binding.name),
      })),
    },
  };
}

function attachTsrxColorlessPolicy(
  ctx: Ctx,
  component: t.JSXElement,
  sourceProps: readonly ComponentSourceProp[],
  policy: TransparentPresentationPolicy,
): void {
  const policies = ctx.transparentGroupCallPolicies.get(component) ?? new Map();
  for (const { prop } of sourceProps) policies.set(prop, policy);
  ctx.transparentGroupCallPolicies.set(component, policies);
}

function lowerTsrxTryBoundary(
  ctx: Ctx,
  node: BaseNode,
  metadata: TsrxTryMetadata,
  generatedPolicies: t.FunctionDeclaration[],
  programPath: {
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): BaseNode {
  if (node.type !== 'JSXFragment') return node;
  const children = (node as unknown as t.JSXFragment).children.filter(
    (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
  );
  if (children.length !== 1 || !astFactory.isJSXElement(children[0])) {
    throw programPath.buildCodeFrameError(
      'memo-dom: TSRX @try currently requires one direct component output',
      node as unknown as t.Node,
    );
  }
  const component = children[0];
  const tag = jsxTagName(component);
  if (tag === null || !/^[A-Z]/.test(tag)) {
    throw programPath.buildCodeFrameError(
      'memo-dom: TSRX @try currently requires one direct component output',
      component,
    );
  }
  const suspend = suspendDirective(component, programPath);
  const sourceProps = componentSourceProps(ctx, component);
  const dependencies = [...new Set(sourceProps.map(({ source }) => source))];
  if (sourceProps.length === 0) {
    throw programPath.buildCodeFrameError(
      `memo-dom: TSRX @try component <${tag}> requires at least one direct colorless-source prop`,
      component,
    );
  }
  ctx.usesTransparentData = true;
  if (suspend === null) {
    if (metadata.handler === null) {
      throw programPath.buildCodeFrameError(
        'memo-dom: unsuspended TSRX @try requires @catch so colorless source failures have a local policy',
        node as unknown as t.Node,
      );
    }
    if (!astFactory.isIdentifier(metadata.handler.param as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier error parameter',
        metadata.handler.param as unknown as t.Node,
      );
    }
    if (!astFactory.isIdentifier(metadata.handler.resetParam as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier reset parameter',
        metadata.handler.resetParam as unknown as t.Node,
      );
    }
    const pendingOutput = metadata.pending ?? astFactory.jsxFragment(
      astFactory.jsxOpeningFragment(),
      astFactory.jsxClosingFragment(),
      [],
    ) as unknown as BaseNode;
    const pending = tsrxPolicyComponent(
      ctx,
      node,
      pendingOutput,
      'pending',
      null,
    );
    const error = tsrxPolicyComponent(
      ctx,
      node,
      metadata.handler.output,
      'error',
      metadata.handler,
    );
    generatedPolicies.push(pending.declaration, error.declaration);
    attachTsrxColorlessPolicy(ctx, component, sourceProps, {
      pending: pending.renderer,
      error: error.renderer,
    });
    return component as unknown as BaseNode;
  }
  consumeSuspendDirective(component, suspend);
  return suspendedTsrxTryOutput(
    ctx,
    component,
    dependencies,
    metadata,
    programPath,
  ) as unknown as BaseNode;
}

/** Normalize the exact three-child Group form into independent local sites. */
export function lowerTransparentGroups(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): void {
  const generatedPolicies: t.FunctionDeclaration[] = [];
  refreshAstAnalysis(ctx, programPath.node);
  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    leave(node) {
        const tryMetadata = tsrxTryMetadata(node);
        if (tryMetadata !== null) {
          replaceNode(
            ctx.astAnalysis!,
            node,
            lowerTsrxTryBoundary(
              ctx,
              node,
              tryMetadata,
              generatedPolicies,
              programPath,
            ),
          );
          return;
        }
        if (node.type !== 'JSXElement') return;
        const element = node as unknown as t.JSXElement;
        const tag = jsxTagName(element);
        if (tag === null || !ctx.transparentGroups.has(tag)) return;
        const children = meaningfulGroupChildren(element, programPath);
        if (children.length !== 3) {
          throw programPath.buildCodeFrameError(
            'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
            element,
          );
        }
        const [pendingElement, errorElement, content] = children;
        if (!astFactory.isJSXElement(pendingElement) || !astFactory.isJSXElement(errorElement)) {
          throw programPath.buildCodeFrameError(
            'memo-dom: Group children one and two must be Pending and Error declarations',
            element,
          );
        }
        const pending = componentPolicy(
          ctx,
          pendingElement,
          ctx.transparentPendingPolicies,
          'Pending',
          'pending',
          generatedPolicies,
          programPath,
        );
        const error = componentPolicy(
          ctx,
          errorElement,
          ctx.transparentErrorPolicies,
          'Error',
          'error',
          generatedPolicies,
          programPath,
        );
        const contentSuspend = astFactory.isJSXElement(content)
          ? suspendDirective(content, programPath)
          : null;
        const data = inferredGroupDataNames(
          ctx,
          element,
          content as unknown as BaseNode,
          programPath,
        );
        const origins = groupOrigins(
          ctx,
          node,
          data,
        );
        if (astFactory.isJSXElement(content)) {
          if (contentSuspend !== null) {
            if (data.length === 0) {
              throw programPath.buildCodeFrameError(
                'memo-dom: suspended Group content must read colorless sources in the current component; descendant-owned sources can use this Group only in colorless mode',
                contentSuspend,
              );
            }
            consumeSuspendDirective(content, contentSuspend);
            replaceNode(
              ctx.astAnalysis!,
              node,
              suspendedGroupOutput(
                ctx,
                content,
                data,
                pending,
                error,
              ) as unknown as BaseNode,
            );
            ctx.usesTransparentData = true;
            return;
          }
        }
        annotateGroupComponentCalls(
          ctx,
          content as unknown as BaseNode,
          origins,
          pending,
          error,
        );
        walkAst(content as unknown as BaseNode, {
          enter(current) {
            if (current.type !== 'JSXExpressionContainer') return;
            const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
            if (parent?.type === 'JSXAttribute') return false;
            const expression = childNode(current, 'expression');
            if (
              expression === null ||
              !astFactory.isExpression(expression as unknown as t.Node)
            ) return false;
            const authoredExpression = expression as unknown as t.Expression;
            if (isLoweredGroupExpression(authoredExpression)) return false;
            const used = expressionOrigins(ctx, expression, origins);
            if (used.size === 0) return undefined;
            wrapGroupSite(ctx, authoredExpression, [...used], pending, error);
            return false;
          },
        });
        ctx.usesTransparentData = true;
        // Move the authored content node so Group's internal lowering markers
        // survive into the later transparent-read pass.
        replaceNode(
          ctx.astAnalysis!,
          node,
          content as unknown as BaseNode,
        );
    },
  });
  programPath.node.body.push(...generatedPolicies);
  refreshAstAnalysis(ctx, programPath.node);
  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type !== 'JSXElement') return;
      const element = node as unknown as t.JSXElement;
      const tag = jsxTagName(element);
      if (tag === null || !/^[A-Z]/.test(tag)) return;
      if (suspendDirective(element, programPath) === null) return;
      throw programPath.buildCodeFrameError(
        'memo-dom: suspend requires the element to be the direct content child of Group',
        element,
      );
    },
  });
}

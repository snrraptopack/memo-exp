/**
 * Compiler-transparent async data sources.
 *
 * The public binding is typed as ResolvedValue<T>, while generated code keeps
 * the library's source holder. Reads are lowered either to a render gate or an
 * imperative resolution guard; source transitions push the owning component
 * through the ordinary runtime dirty queue.
 */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import {
  astBindingAt,
  nodeHasJsx,
  refreshAstAnalysis,
  type Ctx,
  type TransparentPresentationComponent,
  type TransparentPresentationPolicy,
} from './context';
import {
  analyzeScope,
  childNode,
  extractPatternIdentifiers,
  isReferenceIdentifier,
  isValidIdentifier as isValidEstreeIdentifier,
  nodeFields as fields,
  overwriteNode,
  replaceNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from './ast';
import { jsxAttributeName } from './jsx/attributes';
import {
  generatedComponentIdentifier,
  generatedIdentifier,
  mdd,
} from './identifiers';
import { isCallToImported } from './features/data-sources/discovery';
import {
  annotateTransparentSources,
  excludeTransparentSubscriptions,
  sourceArray,
  transparentExpressionSources,
  type RenderGatedExpression,
} from './features/data-sources/subscriptions';

export {
  registerTransparentSourceRoots,
  rejectNonGetServerFunctionRenderCalls,
  rejectTransparentSourceDestructuring,
  scanAndLowerModuleSourceDeclarations,
  scanEventSourceAssignments,
  scanTransparentSourceBindings,
  scanTransparentSourceImports,
  registerTransparentDataSite,
  subscribeTransparentStructuralSite,
  transparentCallPolicyArgument,
  transparentExpressionSources,
  transparentSourceMounts,
} from './features/data-sources';

function jsxTagName(element: t.JSXElement): string | null {
  return astFactory.isJSXIdentifier(element.openingElement.name)
    ? element.openingElement.name.name
    : null;
}

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

function transparentSourceBindingName(
  ctx: Ctx,
  identifier: t.Identifier,
): string | null {
  const name = identifier.name;
  const binding = astBindingAt(
    ctx,
    identifier as unknown as BaseNode,
    name,
  );
  if (binding === undefined || !binding.references.includes(identifier as unknown as AstIdentifier)) {
    return null;
  }
  if (ctx.transparentModuleSources.has(name)) return name;
  const parent = ctx.astAnalysis?.parentByNode.get(binding.identifier) ?? null;
  if (parent?.type !== 'VariableDeclarator') return null;
  const init = childNode(parent, 'init');
  if (
    init === null ||
    !astFactory.isCallExpression(init as unknown as t.Node) ||
    !isCallToImported(
      ctx,
      identifier as unknown as BaseNode,
      init as unknown as t.Expression,
      ctx.transparentSourceFactories,
    )
  ) {
    return null;
  }
  return name;
}

interface ComponentSourceProp {
  prop: string;
  source: string;
}

function componentSourceProps(
  ctx: Ctx,
  element: t.JSXElement,
): ComponentSourceProp[] {
  const sources = new Map<string, string>();
  for (const attribute of element.openingElement.attributes) {
    if (
      !astFactory.isJSXAttribute(attribute) ||
      !astFactory.isJSXIdentifier(attribute.name) ||
      !astFactory.isJSXExpressionContainer(attribute.value) ||
      !astFactory.isIdentifier(attribute.value.expression)
    ) {
      continue;
    }
    const source = transparentSourceBindingName(ctx, attribute.value.expression);
    if (source !== null) sources.set(attribute.name.name, source);
  }
  return [...sources].map(([prop, source]) => ({ prop, source }));
}

function rejectGroupDataAttribute(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): void {
  const data = element.openingElement.attributes.find((attribute) =>
    astFactory.isJSXAttribute(attribute) &&
    astFactory.isJSXIdentifier(attribute.name, { name: 'data' }),
  );
  if (data === undefined) return;
  throw errorAt.buildCodeFrameError(
    'memo-dom: Group infers colorless sources from its content; remove the data prop',
    data,
  );
}

function inferredGroupDataNames(
  ctx: Ctx,
  element: t.JSXElement,
  content: BaseNode,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): string[] {
  rejectGroupDataAttribute(element, errorAt);
  const candidates = new Set<string>();
  let component = ctx.astAnalysis?.parentByNode.get(element as unknown as BaseNode) ?? null;
  while (component !== null && component.type !== 'FunctionDeclaration') {
    component = ctx.astAnalysis?.parentByNode.get(component) ?? null;
  }
  if (component !== null) {
    const declaration = component as unknown as t.FunctionDeclaration;
    if (declaration.id !== null) {
      // Source discovery has already proven which component-local bindings are
      // colorless resources. Seed every one of those bindings here, then let
      // the origin walk below retain only the sources actually used by this
      // Group's content. Scanning only top-level references loses sources whose
      // first read occurs inside an immediately-evaluated callback, such as a
      // `projects.map(project => tasks.filter(...))` derivation.
      for (const source of ctx.transparentSources.get(declaration.id.name) ?? []) {
        candidates.add(source);
      }
      const linked = ctx.linkedComponentPropSources.get(declaration.id.name);
      const parameter = declaration.params[0];
      const transparentProps = new Set<string>();
      for (const [prop, origin] of linked ?? []) {
        if (origin.transparent) transparentProps.add(prop);
      }
      let program: BaseNode = component;
      while (ctx.astAnalysis?.parentByNode.get(program) !== null && ctx.astAnalysis?.parentByNode.get(program) !== undefined) {
        program = ctx.astAnalysis.parentByNode.get(program)!;
      }
      walkAst(program, {
        enter(node) {
          if (node.type !== 'JSXElement') return;
          const call = node as unknown as t.JSXElement;
          if (jsxTagName(call) !== declaration.id!.name) return;
          for (const attribute of call.openingElement.attributes) {
            if (
              !astFactory.isJSXAttribute(attribute) ||
              !astFactory.isJSXIdentifier(attribute.name) ||
              !astFactory.isJSXExpressionContainer(attribute.value) ||
              !astFactory.isIdentifier(attribute.value.expression)
            ) continue;
            if (transparentSourceBindingName(ctx, attribute.value.expression) !== null) {
              transparentProps.add(attribute.name.name);
            }
          }
        },
      });
      if (astFactory.isObjectPattern(parameter)) {
        for (const prop of transparentProps) {
          for (const property of parameter.properties) {
            if (
              astFactory.isObjectProperty(property) &&
              !property.computed &&
              astFactory.isIdentifier(property.key, { name: prop }) &&
              astFactory.isIdentifier(property.value)
            ) {
              candidates.add(property.value.name);
            }
          }
        }
      }
    }
    walkAst(component, {
      enter(node) {
        // Nested declarations are separate components/helpers. Function and
        // arrow expressions, however, can be immediately evaluated as part of
        // a render derivation (`items.map(() => otherSource.filter(...))`).
        // Keep walking those closures so every proven source is available to
        // the later content-origin filter.
        if (node !== component && node.type === 'FunctionDeclaration') {
          return false;
        }
        if (node.type !== 'Identifier') return;
        const source = transparentSourceBindingName(
          ctx,
          node as unknown as t.Identifier,
        );
        if (source !== null) candidates.add(source);
      },
    });
  }
  const origins = groupOrigins(ctx, element as unknown as BaseNode, [...candidates]);
  const used = [...expressionOrigins(ctx, content, origins)].sort();
  return used;
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

type GroupOrigins = Map<AstBinding, Set<string>>;

function expressionOrigins(
  ctx: Ctx,
  root: BaseNode,
  origins: ReadonlyMap<AstBinding, ReadonlySet<string>>,
): Set<string> {
  const found = new Set<string>();
  const note = (identifier: AstIdentifier): void => {
    const binding = astBindingAt(ctx, identifier, identifier.name);
    if (binding === undefined || !binding.references.includes(identifier)) return;
    for (const source of origins.get(binding) ?? []) found.add(source);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node as unknown as AstIdentifier);
    },
  });
  return found;
}

function groupOrigins(
  ctx: Ctx,
  element: BaseNode,
  sources: readonly string[],
): GroupOrigins {
  const origins: GroupOrigins = new Map();
  for (const source of sources) {
    const binding = astBindingAt(ctx, element, source);
    if (binding !== undefined) origins.set(binding, new Set([source]));
  }
  let component = ctx.astAnalysis?.parentByNode.get(element) ?? null;
  while (component !== null && component.type !== 'FunctionDeclaration') {
    component = ctx.astAnalysis?.parentByNode.get(component) ?? null;
  }
  if (component === null) return origins;
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(component, {
      enter(node) {
        if (node !== component && (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration'
        )) return false;
        if (node.type !== 'VariableDeclarator') return undefined;
        const init = childNode(node, 'init');
        const pattern = childNode(node, 'id');
        if (init === null || pattern === null) return undefined;
        const dependencies = expressionOrigins(ctx, init, origins);
        if (dependencies.size === 0) return;
        for (const identifier of extractPatternIdentifiers(pattern)) {
          const binding = astBindingAt(ctx, identifier, identifier.name);
          if (binding === undefined) continue;
          const current = origins.get(binding) ?? new Set<string>();
          const before = current.size;
          for (const source of dependencies) current.add(source);
          origins.set(binding, current);
          changed ||= current.size !== before;
        }
        return undefined;
      },
    });
  }
  return origins;
}

function isLoweredGroupExpression(expression: t.Expression): boolean {
  return (expression as t.Expression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup === true;
}

function componentPropName(attribute: t.JSXAttribute): string | null {
  return astFactory.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : null;
}

function annotateGroupComponentCalls(
  ctx: Ctx,
  content: BaseNode,
  origins: ReadonlyMap<AstBinding, ReadonlySet<string>>,
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): void {
  const note = (node: BaseNode): void => {
    const element = node as unknown as t.JSXElement;
    const tag = jsxTagName(element);
    if (tag === null || !/^[A-Z]/.test(tag)) return;
    let policies = ctx.transparentGroupCallPolicies.get(element);
    policies ??= new Map();
    // A source-less component boundary still inherits the Group's nearest
    // presentation policy. The child may own its own colorless sources or
    // forward the policy through another component before one is created.
    if (!policies.has('$default')) {
      policies.set('$default', { pending, error });
    }
    for (const attribute of element.openingElement.attributes) {
      if (!astFactory.isJSXAttribute(attribute)) continue;
      const prop = componentPropName(attribute);
      const value = attribute.value;
      if (
        prop === null ||
        !astFactory.isJSXExpressionContainer(value)
      ) continue;
      const expression = value.expression;
      if (
        !astFactory.isIdentifier(expression) ||
        expressionOrigins(
          ctx,
          expression as unknown as BaseNode,
          origins,
        ).size === 0
      ) continue;
      // Inner groups run first (exit traversal) and own the nearest match.
      if (!policies.has(prop)) policies.set(prop, { pending, error });
    }
    ctx.transparentGroupCallPolicies.set(element, policies);
  };
  walkAst(content, {
    enter(node) {
      if (node.type === 'JSXElement') note(node);
    },
  });
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

function wrapAutomaticSite(
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

function isBoundTo(
  ctx: Ctx,
  identifier: BaseNode,
  binding: AstBinding,
): boolean {
  if (identifier.type !== 'Identifier') return false;
  const astIdentifier = identifier as unknown as AstIdentifier;
  const resolved = astBindingAt(ctx, identifier, astIdentifier.name);
  return resolved?.identifier === binding.identifier &&
    resolved.references.includes(astIdentifier);
}

function isEventOrRefContainer(ctx: Ctx, container: BaseNode): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (parent?.type !== 'JSXAttribute') return false;
  const name = jsxAttributeName(
    (parent as unknown as t.JSXAttribute).name,
  );
  return name === 'ref' || /^on[A-Z]/.test(name);
}

function isComponentPropContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const name = (opening as unknown as t.JSXOpeningElement).name;
  return astFactory.isJSXIdentifier(name) && /^[A-Z]/.test(name.name);
}

function isDirectSourceComponentProp(
  ctx: Ctx,
  container: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  if (!isComponentPropContainer(ctx, container)) return false;
  const expression = childNode(container, 'expression');
  if (expression?.type !== 'Identifier') return false;
  const name = (expression as unknown as AstIdentifier).name;
  const binding = bindings.get(name);
  return binding !== undefined && isBoundTo(ctx, expression, binding);
}

function isWithinDirectSourceComponentProp(
  ctx: Ctx,
  identifier: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  const container = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (
    container?.type !== 'JSXExpressionContainer' ||
    childNode(container, 'expression') !== identifier
  ) {
    return false;
  }
  return isDirectSourceComponentProp(ctx, container, bindings);
}

function isGroupDataContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (
    attribute?.type !== 'JSXAttribute' ||
    jsxAttributeName((attribute as unknown as t.JSXAttribute).name) !== 'data'
  ) {
    return false;
  }
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  return (
    opening?.type === 'JSXOpeningElement' &&
    astFactory.isJSXIdentifier(
      (opening as unknown as t.JSXOpeningElement).name,
      { name: 'Group' },
    )
  );
}

function isWithinGroupData(ctx: Ctx, node: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (current !== null && current.type !== 'JSXExpressionContainer') {
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return current !== null && isGroupDataContainer(ctx, current);
}

function isPassthroughArgument(
  ctx: Ctx,
  identifier: BaseNode,
): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent?.type !== 'CallExpression') return false;
  const call = parent as unknown as t.CallExpression;
  if (!call.arguments.includes(identifier as unknown as t.Expression)) return false;
  const root = astFactory.isIdentifier(call.callee) ? call.callee.name : null;
  return root !== null && ctx.transparentSourcePassthroughs.has(root);
}

function isActionRefreshTarget(ctx: Ctx, identifier: BaseNode): boolean {
  let array = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (array !== null && array.type !== 'ArrayExpression') {
    array = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  }
  if (array === null) return false;
  const property = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  if (property?.type !== 'ObjectProperty' && property?.type !== 'Property') {
    return false;
  }
  if (childNode(property, 'value') !== array) return false;
  const objectProperty = property as unknown as t.ObjectProperty;
  const key = objectProperty.key;
  return (
    (!objectProperty.computed && astFactory.isIdentifier(key, { name: 'refresh' })) ||
    astFactory.isStringLiteral(key, { value: 'refresh' })
  );
}

function isGeneratedDataCall(ctx: Ctx, node: BaseNode): boolean {
  let call = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (call !== null && call.type !== 'CallExpression') {
    call = ctx.astAnalysis?.parentByNode.get(call) ?? null;
  }
  if (call === null) return false;
  const callee = (call as unknown as t.CallExpression).callee;
  return (
    astFactory.isMemberExpression(callee) &&
    astFactory.isIdentifier(callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    })
  );
}

function sourceBindings(
  ctx: Ctx,
  component: BaseNode,
  names: ReadonlySet<string>,
): Map<string, AstBinding> {
  const bindings = new Map<string, AstBinding>();
  for (const name of names) {
    const binding = astBindingAt(ctx, component, name);
    if (binding !== undefined) bindings.set(name, binding);
  }
  return bindings;
}

/**
 * Event-created sources are nullable holders before their first assignment.
 * Writes and existence guards inspect the holder itself; only later property
 * reads consume its resolved payload.
 */
function isEventSourceHolderReference(
  ctx: Ctx,
  identifier: BaseNode,
  eventSources: ReadonlySet<string>,
): boolean {
  if (
    identifier.type !== 'Identifier' ||
    !eventSources.has((identifier as unknown as AstIdentifier).name)
  ) return false;
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent === null) return false;
  if (
    parent.type === 'AssignmentExpression' &&
    childNode(parent, 'left') === identifier
  ) return true;
  if (
    parent.type === 'BinaryExpression' ||
    parent.type === 'LogicalExpression'
  ) {
    const left = childNode(parent, 'left');
    const right = childNode(parent, 'right');
    if (
      parent.type === 'BinaryExpression' &&
      ['==', '!=', '===', '!=='].includes(
        (parent as unknown as t.BinaryExpression).operator,
      )
    ) {
      const other = left === identifier ? right : left;
      if (other !== null && astFactory.isNullLiteral(other as unknown as t.Node)) {
        return true;
      }
    }
    if (parent.type === 'LogicalExpression' && left === identifier) return true;
  }
  if (
    parent.type === 'UnaryExpression' &&
    (parent as unknown as t.UnaryExpression).operator === '!' &&
    childNode(parent, 'argument') === identifier
  ) return true;
  if (
    (parent.type === 'ConditionalExpression' || parent.type === 'IfStatement') &&
    childNode(parent, 'test') === identifier
  ) return true;
  return false;
}

function sourceDependencies(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<
    string,
    { binding: AstBinding; sources: readonly string[]; expression: t.Expression }
  >,
  eventSources: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding !== undefined && isBoundTo(ctx, identifier, binding)) {
      if (
        !isPassthroughArgument(ctx, identifier) &&
        !isEventSourceHolderReference(ctx, identifier, eventSources)
      ) {
        found.add(name);
      }
      return;
    }
    const derivation = derived.get(name);
    if (
      derivation !== undefined &&
      isBoundTo(ctx, identifier, derivation.binding)
    ) {
      for (const source of derivation.sources) found.add(source);
    }
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  return [...found].sort();
}

function replaceDerivedReads(
  ctx: Ctx,
  root: BaseNode,
  derived: ReadonlyMap<
    string,
    { binding: AstBinding; sources: readonly string[]; expression: t.Expression }
  >,
): void {
  const found: Array<{ identifier: BaseNode; expression: t.Expression }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const projection = derived.get(name);
    if (
      projection === undefined ||
        !isBoundTo(ctx, node, projection.binding)
    ) return;
      found.push({ identifier: node, expression: projection.expression });
      return false;
    },
  });
  for (const { identifier, expression } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(expression, true) as unknown as BaseNode,
    );
  }
}

function trackDependencies(
  ctx: Ctx,
  root: BaseNode,
  tracks: ReadonlyMap<string, readonly string[]>,
  bindings: ReadonlyMap<string, AstBinding>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const sources = tracks.get(name);
    if (sources === undefined) return;
    const binding = astBindingAt(ctx, root, name);
    if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
    for (const source of sources) found.add(source);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') {
        note(node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const call = node as unknown as t.CallExpression;
      if (
        !astFactory.isIdentifier(call.callee) ||
        !ctx.transparentTrackFactories.has(call.callee.name) ||
        astBindingAt(ctx, node, call.callee.name)?.kind !== 'import'
      ) return;
      const argument = call.arguments[0];
      if (!astFactory.isIdentifier(argument)) return;
      const binding = bindings.get(argument.name);
      if (
        binding !== undefined &&
        isBoundTo(ctx, argument as unknown as BaseNode, binding)
      ) found.add(argument.name);
    },
  });
  return [...found].sort();
}

function replaceSourceReads(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  replacements: ReadonlyMap<string, t.Identifier>,
  eventSources: ReadonlySet<string>,
): void {
  const found: Array<{ identifier: BaseNode; replacement: t.Identifier }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const binding = bindings.get(name);
      const replacement = replacements.get(name);
    if (
      binding === undefined ||
        replacement === undefined ||
        !isBoundTo(ctx, node, binding) ||
        isPassthroughArgument(ctx, node) ||
        isEventSourceHolderReference(ctx, node, eventSources)
    ) {
      return;
    }
      found.push({ identifier: node, replacement });
      return false;
    },
  });
  for (const { identifier, replacement } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(replacement) as unknown as BaseNode,
    );
  }
}

/**
 * Render-site semantics for authored control flow: source reads become
 * render-gated (unavailable renders empty, initial failure stays loud) so
 * state-driven branches evaluate immediately while payload sinks self-gate.
 */
function replaceSourceReadsWithRenderGates(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
): void {
  // Collect first, replace after — the replacement call embeds the same
  // identifier, so replacing during traversal would recurse forever.
  const found: BaseNode[] = [];
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
    if (isPassthroughArgument(ctx, identifier)) return;
    if (isEventSourceHolderReference(ctx, identifier, eventSources)) return;
    found.push(identifier);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  for (const identifier of found) {
    const name = (identifier as unknown as AstIdentifier).name;
    overwriteNode(
      identifier,
      astFactory.callExpression(
        mdd(ctx, 'readResolvedValueForRender'),
        [astFactory.identifier(name)],
      ) as unknown as BaseNode,
    );
  }
}

/**
 * A read inside a render-gated subtree is already availability-safe — unless
 * it sits inside a nested function (handler/effect), where the imperative R2
 * guard still applies.
 */
function isInsideRenderGate(ctx: Ctx, identifier: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (current !== null) {
    if (
      (current as unknown as RenderGatedExpression).__memoDomRenderGated === true
    ) {
      return true;
    }
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression' ||
      current.type === 'FunctionDeclaration'
    ) return false;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

function resolvedRenderExpression(
  ctx: Ctx,
  expression: t.Expression,
  dependencies: readonly string[],
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
  helper = 'readResolvedValuesForRender',
): t.Expression {
  const replacements = new Map<string, t.Identifier>();
  const parameters = dependencies.map((source) => {
    const parameter = generatedIdentifier(ctx, `${source}Value`);
    replacements.set(source, parameter);
    return cloneEstreeNode(parameter);
  });
  replaceSourceReads(
    ctx,
    expression as unknown as BaseNode,
    bindings,
    replacements,
    eventSources,
  );
  const callback = astFactory.arrowFunctionExpression(
    parameters,
    cloneEstreeNode(expression, true),
  );
  ctx.compilerOwnedCallbacks.add(callback);
  return astFactory.callExpression(mdd(ctx, helper), [
    astFactory.arrayExpression(
      dependencies.map((source) => astFactory.identifier(source)),
    ),
    callback,
  ]);
}

/**
 * Gate an effect that consumes an event-created colorless value. The holder
 * is absent before the first event and pending immediately after assignment;
 * the slot invalidates the owner again when it settles, at which point the
 * authored callback runs with honest payloads and may return its cleanup.
 */
function gateEventSourceEffects(
  ctx: Ctx,
  component: string,
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
): void {
  if (eventSources.size === 0) return;
  const emptyDerived = new Map<
    string,
    { binding: AstBinding; sources: readonly string[]; expression: t.Expression }
  >();
  for (const site of ctx.effects.get(component) ?? []) {
    const callback = site.callback;
    if (
      !astFactory.isArrowFunctionExpression(callback) &&
      !astFactory.isFunctionExpression(callback)
    ) continue;
    const dependencies = sourceDependencies(
      ctx,
      callback as unknown as BaseNode,
      bindings,
      emptyDerived,
      eventSources,
    );
    if (!dependencies.some(source => eventSources.has(source))) continue;

    const replacements = new Map<string, t.Identifier>();
    const parameters = dependencies.map(source => {
      const parameter = generatedIdentifier(ctx, `${source}EffectValue`);
      replacements.set(source, parameter);
      return cloneEstreeNode(parameter);
    });
    replaceSourceReads(
      ctx,
      callback.body as unknown as BaseNode,
      bindings,
      replacements,
      eventSources,
    );
    const run = astFactory.arrowFunctionExpression(
      parameters,
      cloneEstreeNode(callback.body, true),
    );
    ctx.compilerOwnedCallbacks.add(run);
    const gated = astFactory.arrowFunctionExpression(
      [],
      astFactory.callExpression(mdd(ctx, 'runResolvedValuesEffect'), [
        sourceArray(dependencies),
        run,
      ]),
    );
    ctx.compilerOwnedCallbacks.add(gated);
    site.callback = gated;
  }
}

/**
 * Lower direct scalar/attribute reads, structural sites, transported props,
 * and pure local derivations without evaluating an unavailable source.
 */
/**
 * Lower reads of module-scope source refs inside a component:
 *   - list receivers (.map)  → _MDD.readModuleSourceList(_ref)
 *   - other render sites     → _MDD.readResolvedValueForRender(_ref)
 *   - imperative statements  → _MDD.readResolvedValue(_ref, name, site)
 * Each emitted read materializes the source into the ACTIVE runtime on first
 * touch (request-local on the server).
 */
interface EstreeModuleSourceEntry {
  name: string;
  key: string;
  binding: AstBinding;
}

function lowerModuleRefReadsEstree(
  ctx: Ctx,
  componentName: string,
  component: BaseNode,
  refresh: () => void,
): void {
  const entries: EstreeModuleSourceEntry[] = [];
  for (const [name, key] of ctx.transparentModuleSources) {
    const binding = astBindingAt(ctx, component, name);
    if (binding !== undefined) entries.push({ name, key, binding });
  }
  if (entries.length === 0) return;
  ctx.usesTransparentData = true;

  const entryFor = (identifier: BaseNode): EstreeModuleSourceEntry | null => {
    if (identifier.type !== 'Identifier') return null;
    const name = (identifier as unknown as AstIdentifier).name;
    const entry = entries.find((candidate) => candidate.name === name);
    return entry !== undefined && isBoundTo(ctx, identifier, entry.binding)
      ? entry
      : null;
  };
  const refCall = (key: string): t.Expression =>
    astFactory.callExpression(mdd(ctx, 'sourceRef'), [astFactory.stringLiteral(key)]);
  const isListReceiver = (identifier: BaseNode): boolean => {
    const member = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    if (member?.type !== 'MemberExpression') return false;
    const memberNode = member as unknown as t.MemberExpression;
    if (
      memberNode.object !== identifier ||
      memberNode.computed ||
      !astFactory.isIdentifier(memberNode.property, { name: 'map' })
    ) return false;
    return ctx.astAnalysis?.parentByNode.get(member)?.type === 'CallExpression';
  };
  const collect = (root: BaseNode): Array<{
    identifier: BaseNode;
    entry: EstreeModuleSourceEntry;
  }> => {
    const found: Array<{
      identifier: BaseNode;
      entry: EstreeModuleSourceEntry;
    }> = [];
    walkAst(root, {
      enter(node) {
        if (node.type !== 'Identifier') return;
        const entry = entryFor(node);
        if (entry === null || isPassthroughArgument(ctx, node)) return;
        found.push({ identifier: node, entry });
      },
    });
    return found;
  };
  const replaceRead = (
    identifier: BaseNode,
    entry: EstreeModuleSourceEntry,
    helper: 'readModuleSourceList' | 'readResolvedValueForRender',
  ): void => {
    overwriteNode(
      identifier,
      astFactory.callExpression(
        mdd(ctx, helper),
        [refCall(entry.key)],
      ) as unknown as BaseNode,
    );
  };

  walkAst(component, {
    enter(node) {
      if (node.type !== 'JSXExpressionContainer') return;
      if (isEventOrRefContainer(ctx, node)) return false;
      const rawExpression = childNode(node, 'expression');
      if (
        rawExpression === null ||
        !astFactory.isExpression(rawExpression as unknown as t.Node)
      ) return false;
      const expression = rawExpression as unknown as t.Expression;
      const groupMarked = (
        expression as t.Expression & { __memoDomTransparentGroup?: boolean }
      ).__memoDomTransparentGroup === true;

      if (groupMarked) {
        const committedContainers: BaseNode[] = [];
        walkAst(rawExpression, {
          enter(current) {
            let ancestor = ctx.astAnalysis?.parentByNode.get(current) ?? null;
            let insideFragment = false;
            while (ancestor !== null && ancestor !== rawExpression) {
              if (ancestor.type === 'JSXFragment') {
                insideFragment = true;
                break;
              }
              ancestor = ctx.astAnalysis?.parentByNode.get(ancestor) ?? null;
            }
            if (
              current !== node &&
              current.type === 'JSXExpressionContainer' &&
              insideFragment &&
              !isEventOrRefContainer(ctx, current)
            ) committedContainers.push(current);
          },
        });
        for (const container of committedContainers) {
          const inner = childNode(container, 'expression');
          if (inner === null) continue;
          for (const { identifier, entry } of collect(inner)) {
            replaceRead(
              identifier,
              entry,
              isListReceiver(identifier)
                ? 'readModuleSourceList'
                : 'readResolvedValueForRender',
            );
          }
        }
        refresh();
        return false;
      }

      const referenced = collect(rawExpression);
      if (referenced.length === 0) return undefined;
      for (const { identifier, entry } of referenced) {
        if (isListReceiver(identifier)) {
          replaceRead(identifier, entry, 'readModuleSourceList');
        }
      }
      refresh();
      const remaining = collect(rawExpression);
      if (remaining.length > 0) {
        const direct = entryFor(rawExpression);
        if (direct !== null) {
          replaceRead(rawExpression, direct, 'readResolvedValueForRender');
        } else {
          const uniqueEntries = [
            ...new Map(
              remaining.map(({ entry }) => [entry.name, entry]),
            ).values(),
          ];
          const replacements = new Map<string, t.Identifier>();
          const parameters = uniqueEntries.map((entry) => {
            const parameter = generatedIdentifier(ctx, `${entry.name}Value`);
            replacements.set(entry.name, parameter);
            return cloneEstreeNode(parameter);
          });
          for (const { identifier, entry } of remaining) {
            overwriteNode(
              identifier,
              cloneEstreeNode(replacements.get(entry.name)!) as unknown as BaseNode,
            );
          }
          const body = cloneEstreeNode(expression, true);
          const callback = astFactory.arrowFunctionExpression(parameters, body);
          ctx.compilerOwnedCallbacks.add(callback);
          overwriteNode(
            rawExpression,
            astFactory.callExpression(mdd(ctx, 'readResolvedValuesForRender'), [
              astFactory.arrayExpression(uniqueEntries.map((entry) => refCall(entry.key))),
              callback,
            ]) as unknown as BaseNode,
          );
        }
      }
      annotateTransparentSources(
        rawExpression as unknown as t.Expression,
        transparentExpressionSources(
          ctx,
          rawExpression as unknown as t.Expression,
        ),
      );
      refresh();
      return false;
    },
  });

  const derivationDeclarations = new Set(
    (ctx.instanceDerivations.get(componentName) ?? [])
      .map((derivation) => derivation.declaration as unknown as BaseNode),
  );
  const insideDerivationInit = (identifier: BaseNode): boolean => {
    let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    while (current !== null && !current.type.endsWith('Statement')) {
      if (current.type === 'VariableDeclarator') {
        const declaration = ctx.astAnalysis?.parentByNode.get(current) ?? null;
        return declaration !== null && derivationDeclarations.has(declaration);
      }
      current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
    }
    return false;
  };
  const imperative = collect(component).filter(({ identifier }) =>
    !insideDerivationInit(identifier) &&
    !isActionRefreshTarget(ctx, identifier) &&
    !isGeneratedDataCall(ctx, identifier)
  );
  for (const { identifier, entry } of imperative) {
    const site = identifier.loc === null || identifier.loc === undefined
      ? ctx.moduleId
      : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
    overwriteNode(
      identifier,
      astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
        refCall(entry.key),
        astFactory.stringLiteral(entry.name),
        astFactory.stringLiteral(site),
      ]) as unknown as BaseNode,
    );
  }
  refresh();
}

export function rewriteTransparentDataReads(ctx: Ctx): void {
  const refresh = (): void => {
    const root = ctx.astAnalysis?.rootScope.block;
    if (root !== undefined) refreshAstAnalysis(ctx, root);
  };
  // Module-scope sources (RFC §16.4): lower refs to materializing reads
  // first so plain sites are safe immediately; derivation roots themselves
  // are skipped by that pass and owned by the derive pass below.
  for (const [componentName, componentPath] of ctx.compPaths) {
    lowerModuleRefReadsEstree(
      ctx,
      componentName,
      componentPath.node as unknown as BaseNode,
      refresh,
    );
  }
  refresh();
  // Module-scope refs join the same derivation machinery as component-local
  const moduleBinding = (
    component: BaseNode,
    name: string,
  ): AstBinding | undefined => {
    if (!ctx.transparentModuleSources.has(name)) return undefined;
    const binding = astBindingAt(ctx, component, name);
    return binding?.kind === 'import' ? binding : undefined;
  };

  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const localNames =
      ctx.transparentSources.get(component) ?? new Set<string>();
    const bindings = sourceBindings(ctx, componentNode, localNames);
    // Seed module-scope source bindings so derivation and container passes
    // treat imported refs like component-local holders (runtime helpers
    // accept ModuleSourceRef uniformly).
    let hasModuleRefs = false;
    for (const name of ctx.transparentModuleSources.keys()) {
      const binding = moduleBinding(componentNode, name);
      if (binding === undefined) continue;
      bindings.set(name, binding);
      hasModuleRefs = true;
    }
    if (localNames.size === 0 && !hasModuleRefs) continue;
    const names = localNames;
    const eventSources = ctx.eventSourceSlots.get(component) ?? new Set<string>();
    const tracks = ctx.transparentTrackBindings.get(component) ?? new Map();
    const derived = new Map<
      string,
      {
        binding: AstBinding;
        sources: readonly string[];
        expression: t.Expression;
      }
    >();
    for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
      let sources = derivation.sources.filter((source) => names.has(source));
      // Roots that resolve to imported module-scope sources extend the
      // dependency set even though they are not component-local holders.
      const moduleRoots: string[] = [];
      for (const name of ctx.transparentModuleSources.keys()) {
        if (bindings.has(name) && derivation.sources.includes(name)) {
          moduleRoots.push(name);
        }
      }
      sources = [...new Set([...sources, ...moduleRoots])];
      if (sources.length === 0) continue;
      const declaration = derivation.declaration;
      const target = declaration.declarations.find(
        (candidate) => candidate.init !== null &&
          extractPatternIdentifiers(candidate.id as unknown as BaseNode).some(
            (identifier) => derivation.bindings.includes(identifier.name),
          ),
      );
      const init = target?.init;
      if (init === null || init === undefined || !astFactory.isExpression(init)) continue;
      replaceDerivedReads(
        ctx,
        init as unknown as BaseNode,
        derived,
      );
      refresh();
      const projection = cloneEstreeNode(init, true);
      const wrapped = resolvedRenderExpression(
        ctx,
        init,
        sources,
        bindings,
        eventSources,
        'deriveResolvedValues',
      );
      overwriteNode(
        init as unknown as BaseNode,
        wrapped as unknown as BaseNode,
      );
      derivation.source = cloneEstreeNode(wrapped, true);
      for (const name of derivation.bindings) {
        const binding = astBindingAt(ctx, componentNode, name);
        if (binding !== undefined) {
          derived.set(name, {
            binding,
            sources,
            expression: cloneEstreeNode(projection, true),
          });
        }
      }
    }
    refresh();

    gateEventSourceEffects(ctx, component, bindings, eventSources);
    refresh();

    walkAst(componentNode, {
      enter(container) {
        if (container.type !== 'JSXExpressionContainer') return;
        if (
          isEventOrRefContainer(ctx, container) ||
          isGroupDataContainer(ctx, container) ||
          isDirectSourceComponentProp(
            ctx,
            container,
            bindings,
          )
        ) {
          return false;
        }
        const rawExpression = childNode(container, 'expression');
        if (
          rawExpression === null ||
          !astFactory.isExpression(rawExpression as unknown as t.Node)
        ) return false;
        const expression = rawExpression as unknown as t.Expression;
        if (
          (expression as t.Expression & {
            __memoDomTransparentGroup?: boolean;
          }).__memoDomTransparentGroup === true
        ) {
          // Group already owns render policy for this whole generated subtree.
          // Flatten local derivations so the structural entity can update
          // without replaying the whole component owner.
          replaceDerivedReads(
            ctx,
            rawExpression,
            derived,
          );
          return false;
        }
        const dependencies = sourceDependencies(
          ctx,
          rawExpression,
          bindings,
          derived,
          eventSources,
        );
        const stateDependencies = trackDependencies(
          ctx,
          rawExpression,
          tracks,
          bindings,
        );
        if (dependencies.length === 0) {
          if (stateDependencies.length > 0) {
            annotateTransparentSources(expression, stateDependencies);
            excludeTransparentSubscriptions(
              expression,
              stateDependencies.filter(source => eventSources.has(source)),
            );
          }
          return undefined;
        }
        const allDependencies = [
          ...new Set([...dependencies, ...stateDependencies]),
        ].sort();
        replaceDerivedReads(
          ctx,
          rawExpression,
          derived,
        );
        refresh();
        const eventDependencies = allDependencies.filter(source =>
          eventSources.has(source)
        );
        if (
          nodeHasJsx(rawExpression as unknown as t.Node) ||
          dependencies.some((source) =>
            ctx.transparentSourceProps.get(component)?.has(source) === true
          )
        ) {
          if (
            stateDependencies.length > 0 ||
            eventDependencies.length > 0
          ) {
            // Authored control flow driven by request state (RFC §5):
            // the selector and state arms evaluate immediately; payload
            // sinks self-gate per site instead of hiding behind an
            // availability ladder.
            replaceSourceReadsWithRenderGates(
              ctx,
              rawExpression,
              bindings,
              eventSources,
            );
            (expression as RenderGatedExpression).__memoDomRenderGated =
              true;
            annotateTransparentSources(expression, allDependencies);
            excludeTransparentSubscriptions(expression, eventDependencies);
            return false;
          }
          wrapAutomaticSite(ctx, component, expression, dependencies);
          return false;
        }
        const resolved = resolvedRenderExpression(
          ctx,
          expression,
          dependencies,
          bindings,
          eventSources,
        );
        annotateTransparentSources(resolved, allDependencies);
        excludeTransparentSubscriptions(resolved, eventDependencies);
        overwriteNode(rawExpression, resolved as unknown as BaseNode);
        return false;
      },
    });
    refresh();

    const imperativeReads: Array<{ identifier: BaseNode; name: string }> = [];
    walkAst(componentNode, {
      enter(sourceIdentifier) {
        if (sourceIdentifier.type !== 'Identifier') return;
        const name = (sourceIdentifier as unknown as AstIdentifier).name;
        const binding = bindings.get(name);
        if (
          binding === undefined ||
          !isBoundTo(ctx, sourceIdentifier, binding)
        ) return;
        if (
          isPassthroughArgument(ctx, sourceIdentifier) ||
          isEventSourceHolderReference(ctx, sourceIdentifier, eventSources) ||
          isActionRefreshTarget(ctx, sourceIdentifier) ||
          isWithinGroupData(ctx, sourceIdentifier) ||
          isWithinDirectSourceComponentProp(
            ctx,
            sourceIdentifier,
            bindings,
          ) ||
          isInsideRenderGate(ctx, sourceIdentifier) ||
          isGeneratedDataCall(ctx, sourceIdentifier)
        ) {
          return;
        }
        imperativeReads.push({ identifier: sourceIdentifier, name });
      },
    });
    for (const { identifier, name } of imperativeReads) {
        const site = identifier.loc === null || identifier.loc === undefined
          ? ctx.moduleId
          : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
        overwriteNode(
          identifier,
          astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
            astFactory.identifier(name),
            astFactory.stringLiteral(name),
            astFactory.stringLiteral(site),
          ]) as unknown as BaseNode,
        );
    }
    refresh();
  }
}

/**
 * Compiler-transparent async data sources.
 *
 * The public binding is typed as ResolvedValue<T>, while generated code keeps
 * the library's source holder. Reads are lowered either to a render gate or an
 * imperative resolution guard; source transitions push the owning component
 * through the ordinary runtime dirty queue.
 */
import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  astBindingAt,
  refreshAstAnalysis,
  type Ctx,
} from './context';
import {
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from './ast';
import { orderCallProps } from './components/calls';
import { localBindingForProp } from './components/props';
import { generatedIdentifier, md, mdd } from './identifiers';
import {
  registerStmt,
  type EmitScope,
} from './emission/scope';

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function childNode(node: BaseNode, key: string): BaseNode | null {
  const value = fields(node)[key];
  return value !== null && typeof value === 'object' && 'type' in value
    ? value as BaseNode
    : null;
}

function importedName(specifier: t.ImportSpecifier): string {
  return t.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

/** Resolve provider metadata to local import aliases before module analysis. */
export function scanTransparentSourceImports(
  ctx: Ctx,
  programPath: { node: t.Program },
): void {
  const definitions = new Map(
    ctx.transparentAsyncSources.map((definition) => [
      definition.module,
      definition,
    ]),
  );
  for (const statement of programPath.node.body) {
    if (!t.isImportDeclaration(statement)) continue;
    const definition = definitions.get(statement.source.value);
    if (definition === undefined) continue;
    for (const specifier of statement.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue;
      const name = importedName(specifier);
      if (name === definition.source) {
        ctx.transparentSourceFactories.add(specifier.local.name);
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      if (name === definition.track || name === definition.operations) {
        ctx.transparentSourcePassthroughs.add(specifier.local.name);
        if (name === definition.track) {
          ctx.transparentTrackFactories.add(specifier.local.name);
        }
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      if (name === definition.group) {
        ctx.transparentGroups.add(specifier.local.name);
      }
      if (name === definition.pending) {
        ctx.transparentPendingPolicies.add(specifier.local.name);
      }
      if (name === definition.error) {
        ctx.transparentErrorPolicies.add(specifier.local.name);
      }
    }
  }
}

function jsxTagName(element: t.JSXElement): string | null {
  return t.isJSXIdentifier(element.openingElement.name)
    ? element.openingElement.name.name
    : null;
}

function meaningfulGroupChildren(
  path: NodePath<t.JSXElement>,
): NodePath<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer>[] {
  return path.get('children').filter((child): child is NodePath<
    t.JSXElement | t.JSXFragment | t.JSXExpressionContainer
  > => {
    if (child.isJSXText()) {
      if (child.node.value.trim() !== '') {
        throw child.buildCodeFrameError(
          'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
        );
      }
      return false;
    }
    if (
      child.isJSXExpressionContainer() &&
      child.get('expression').isJSXEmptyExpression()
    ) {
      return false;
    }
    return child.isJSXElement() ||
      child.isJSXFragment() ||
      child.isJSXExpressionContainer();
  });
}

function componentPolicy(
  path: NodePath<t.JSXElement>,
  expected: ReadonlySet<string>,
  label: string,
): string {
  const tag = jsxTagName(path.node);
  if (tag === null || !expected.has(tag)) {
    throw path.buildCodeFrameError(
      `memo-dom: Group child must be <${label} component={...} />`,
    );
  }
  const attributes = path.node.openingElement.attributes;
  if (attributes.length !== 1 || !t.isJSXAttribute(attributes[0])) {
    throw path.buildCodeFrameError(
      `memo-dom: <${label}> requires exactly one component prop`,
    );
  }
  const attribute = attributes[0];
  const name = t.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : null;
  const value = attribute.value;
  if (
    name !== 'component' ||
    !t.isJSXExpressionContainer(value) ||
    !t.isIdentifier(value.expression)
  ) {
    throw path.buildCodeFrameError(
      `memo-dom: <${label}> component must reference a component identifier`,
    );
  }
  return value.expression.name;
}

function groupDataNames(path: NodePath<t.JSXElement>): string[] {
  const attributes = path.node.openingElement.attributes;
  const data = attributes.find((attribute) =>
    t.isJSXAttribute(attribute) &&
    t.isJSXIdentifier(attribute.name, { name: 'data' }),
  );
  if (
    !t.isJSXAttribute(data) ||
    !t.isJSXExpressionContainer(data.value)
  ) {
    throw path.buildCodeFrameError(
      'memo-dom: <Group> requires data={source} or data={{ source, ... }}',
    );
  }
  const expression = data.value.expression;
  if (t.isIdentifier(expression)) return [expression.name];
  if (!t.isObjectExpression(expression)) {
    throw path.buildCodeFrameError(
      'memo-dom: Group.data currently accepts a source identifier or an object of source identifiers',
    );
  }
  const names: string[] = [];
  for (const property of expression.properties) {
    if (
      !t.isObjectProperty(property) ||
      property.computed ||
      !t.isIdentifier(property.value)
    ) {
      throw path.buildCodeFrameError(
        'memo-dom: every Group.data object value must be a source identifier',
      );
    }
    names.push(property.value.name);
  }
  return [...new Set(names)];
}

function policyElement(name: string, attributes: t.JSXAttribute[]): t.JSXElement {
  return t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier(name), attributes, true),
    null,
    [],
  );
}

function sourceArray(names: readonly string[]): t.ArrayExpression {
  return t.arrayExpression(names.map((name) => t.identifier(name)));
}

type TransparentDataExpression = t.Expression & {
  __memoDomTransparentSources?: readonly string[];
};

/**
 * Marks authored control flow whose state-driven branches must evaluate
 * immediately while payload sinks self-gate per site (RFC §5 vs §10).
 */
type RenderGatedExpression = t.Expression & {
  __memoDomRenderGated?: true;
};

function annotateTransparentSources(
  expression: t.Expression,
  sources: readonly string[],
): void {
  const current = (expression as TransparentDataExpression)
    .__memoDomTransparentSources ?? [];
  (expression as TransparentDataExpression).__memoDomTransparentSources = [
    ...new Set([...current, ...sources]),
  ].sort();
}

/** Base source bindings whose transition must update this emitted expression. */
export function transparentExpressionSources(
  ctx: Ctx,
  expression: t.Expression,
): readonly string[] {
  const found = new Set(
    (expression as TransparentDataExpression).__memoDomTransparentSources ?? [],
  );
  const visit = (node: t.Node): void => {
    if (
      t.isCallExpression(node) &&
      t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.object, {
        name: ctx.identifiers?.dataRuntimeId,
      }) &&
      t.isIdentifier(node.callee.property)
    ) {
      const helper = node.callee.property.name;
      if (
        (helper === 'readResolvedValue' ||
          helper === 'readResolvedValueForRender') &&
        t.isIdentifier(node.arguments[0])
      ) {
        found.add(node.arguments[0].name);
      }
      // Module sources: readResolvedValueForRender(sourceRef("key")) /
      // readModuleSourceList(sourceRef("key")) — identity is the key itself.
      if (
        (helper === 'readModuleSourceList' ||
          helper === 'readResolvedValueForRender') &&
        t.isCallExpression(node.arguments[0]) &&
        t.isMemberExpression(node.arguments[0].callee) &&
        t.isIdentifier(node.arguments[0].callee.property, {
          name: 'sourceRef',
        }) &&
        t.isStringLiteral(node.arguments[0].arguments[0])
      ) {
        found.add(node.arguments[0].arguments[0].value);
      }
      if (
        (helper === 'readResolvedValuesForRender' ||
          helper === 'deriveResolvedValues') &&
        t.isArrayExpression(node.arguments[0])
      ) {
        for (const element of node.arguments[0].elements) {
          if (t.isIdentifier(element)) {
            found.add(element.name);
            continue;
          }
          // Module lowering emits sourceRef("key") elements; identity is
          // the canonical key itself.
          if (
            t.isCallExpression(element) &&
            t.isMemberExpression(element.callee) &&
            t.isIdentifier(element.callee.property, { name: 'sourceRef' }) &&
            t.isStringLiteral(element.arguments[0])
          ) {
            found.add(element.arguments[0].value);
          }
        }
      }
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === 'object' && 'type' in entry) {
            visit(entry as t.Node);
          }
        }
      } else if (
        child !== null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        visit(child as t.Node);
      }
    }
  };
  visit(expression);
  return [...found].sort();
}

/**
 * Module-source identities are canonical keys, not valid identifier
 * characters — translate them back to the authored (in-scope) ref binding
 * name so emitted subscriptions reference real bindings.
 */
function routedSourceName(ctx: Ctx, source: string): string {
  for (const [name, key] of ctx.transparentModuleSources) {
    if (key === source) return name;
  }
  return source;
}

function subscribeTransparentEntity(
  ctx: Ctx,
  scope: EmitScope,
  sources: readonly string[],
  entityId: t.Expression,
): void {
  const routed = sources.filter(
    source => !scope.coveredTransparentSources.has(source),
  );
  if (routed.length === 0) return;
  const bindingNames = routed.map((source) => routedSourceName(ctx, source));
  scope.mounts.push(
    t.expressionStatement(
      t.callExpression(md(ctx, 'cleanup'), [
        t.cloneNode(entityId, true),
        t.callExpression(mdd(ctx, 'connectResolvedValues'), [
          sourceArray(bindingNames),
          t.arrowFunctionExpression(
            [],
            t.callExpression(md(ctx, 'markDirty'), [
              t.cloneNode(entityId, true),
            ]),
          ),
        ]),
      ]),
    ),
  );
}

/** Register one exact scalar/prop sink under its smallest structural owner. */
export function registerTransparentDataSite(
  ctx: Ctx,
  scope: EmitScope,
  sources: readonly string[],
  ownerId: t.Expression,
  render: t.Statement,
): boolean {
  const routed = sources.filter(
    source => !scope.coveredTransparentSources.has(source),
  );
  if (routed.length === 0) return false;
  const suffix = `/$data/${scope.dataSiteCounter.count++}`;
  const siteId = t.binaryExpression(
    '+',
    t.cloneNode(ownerId, true),
    t.stringLiteral(suffix),
  );
  scope.creation.push(
    registerStmt(
      ctx,
      t.cloneNode(siteId, true),
      t.cloneNode(ownerId, true),
      t.arrowFunctionExpression([], t.blockStatement([render])),
    ),
  );
  subscribeTransparentEntity(ctx, scope, routed, siteId);
  scope.disposableEntities.push(t.cloneNode(siteId, true));
  return true;
}

/** Route a transparent expression to an already-registered structural entity. */
export function subscribeTransparentStructuralSite(
  ctx: Ctx,
  scope: EmitScope,
  expression: t.Expression,
  entityId: t.Expression,
): void {
  subscribeTransparentEntity(
    ctx,
    scope,
    transparentExpressionSources(ctx, expression),
    entityId,
  );
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
  return t.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : null;
}

function annotateGroupComponentCalls(
  ctx: Ctx,
  content: BaseNode,
  origins: ReadonlyMap<AstBinding, ReadonlySet<string>>,
  pending: string,
  error: string,
): void {
  const note = (node: BaseNode): void => {
    const element = node as unknown as t.JSXElement;
    const tag = jsxTagName(element);
    if (tag === null || !/^[A-Z]/.test(tag)) return;
    let policies = ctx.transparentGroupCallPolicies.get(element);
    for (const attribute of element.openingElement.attributes) {
      if (!t.isJSXAttribute(attribute)) continue;
      const prop = componentPropName(attribute);
      const value = attribute.value;
      if (
        prop === null ||
        !t.isJSXExpressionContainer(value)
      ) continue;
      const expression = value.expression;
      if (
        !t.isIdentifier(expression) ||
        expressionOrigins(
          ctx,
          expression as unknown as BaseNode,
          origins,
        ).size === 0
      ) continue;
      policies ??= new Map();
      // Inner groups run first (exit traversal) and own the nearest match.
      if (!policies.has(prop)) policies.set(prop, { pending, error });
    }
    if (policies !== undefined) {
      ctx.transparentGroupCallPolicies.set(element, policies);
    }
  };
  walkAst(content, {
    enter(node) {
      if (node.type === 'JSXElement') note(node);
    },
  });
}

function wrapGroupSite(
  ctx: Ctx,
  expression: NodePath<t.Expression>,
  dependencies: readonly string[],
  pending: string,
  error: string,
): void {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    t.callExpression(mdd(ctx, 'resolvedValuesError'), [
      t.cloneNode(sources, true),
    ]);
  const retry = t.arrowFunctionExpression(
    [],
    t.callExpression(mdd(ctx, 'retryResolvedValues'), [
      t.cloneNode(sources, true),
    ]),
  );
  const committed = t.jsxFragment(
    t.jsxOpeningFragment(),
    t.jsxClosingFragment(),
    [t.jsxExpressionContainer(t.cloneNode(expression.node, true))],
  );
  const conditional = t.conditionalExpression(
    errorRead(),
    policyElement(error, [
      t.jsxAttribute(
        t.jsxIdentifier('error'),
        t.jsxExpressionContainer(errorRead()),
      ),
      t.jsxAttribute(
        t.jsxIdentifier('retry'),
        t.jsxExpressionContainer(retry),
      ),
    ]),
    t.conditionalExpression(
      t.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        t.cloneNode(sources, true),
      ]),
      policyElement(pending, []),
      committed,
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  expression.replaceWith(conditional);
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
  const element = t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier('mmd-data-policy-render'),
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
  if (parameter === undefined || prop === undefined) return t.nullLiteral();
  return t.optionalMemberExpression(
    t.cloneNode(parameter),
    t.isValidIdentifier(prop) ? t.identifier(prop) : t.stringLiteral(prop),
    !t.isValidIdentifier(prop),
    true,
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
    : t.memberExpression(
        t.arrayExpression(policies),
        t.callExpression(mdd(ctx, indexHelper), [sourceArray(dependencies)]),
        true,
      );
  return selected;
}

function policyMember(
  policy: t.Expression,
  name: 'pending' | 'error',
): t.Expression {
  return t.optionalMemberExpression(
    t.cloneNode(policy),
    t.identifier(name),
    false,
    true,
  );
}

function fragmentExpression(expression: t.Expression): t.JSXFragment {
  return t.jsxFragment(
    t.jsxOpeningFragment(),
    t.jsxClosingFragment(),
    [t.jsxExpressionContainer(expression)],
  );
}

function wrapAutomaticSite(
  ctx: Ctx,
  component: string,
  expression: NodePath<t.Expression>,
  dependencies: readonly string[],
): void {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    t.callExpression(mdd(ctx, 'resolvedValuesError'), [
      t.cloneNode(sources, true),
    ]);
  const pendingRead = (): t.CallExpression =>
    t.callExpression(mdd(ctx, 'resolvedValuesPending'), [
      t.cloneNode(sources, true),
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
  const retry = t.arrowFunctionExpression(
    [],
    t.callExpression(mdd(ctx, 'retryResolvedValues'), [
      t.cloneNode(sources, true),
    ]),
  );
  const conditional = t.conditionalExpression(
    t.logicalExpression('&&', errorRead(), t.cloneNode(errorRenderer)),
    policyRendererElement(t.cloneNode(errorRenderer), [errorRead(), retry]),
    t.conditionalExpression(
      errorRead(),
      fragmentExpression(
        t.callExpression(mdd(ctx, 'throwResolvedValuesError'), [
          t.cloneNode(sources, true),
        ]),
      ),
      t.conditionalExpression(
        t.logicalExpression('&&', pendingRead(), t.cloneNode(pendingRenderer)),
        policyRendererElement(t.cloneNode(pendingRenderer), []),
        t.conditionalExpression(
          pendingRead(),
          t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), []),
          fragmentExpression(t.cloneNode(expression.node, true)),
        ),
      ),
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  expression.replaceWith(conditional);
}

/** Normalize the exact three-child Group form into independent local sites. */
export function lowerTransparentGroups(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  refreshAstAnalysis(ctx, programPath.node);
  programPath.traverse({
    JSXElement: {
      exit(path) {
        const tag = jsxTagName(path.node);
        if (tag === null || !ctx.transparentGroups.has(tag)) return;
        const children = meaningfulGroupChildren(path);
        if (children.length !== 3) {
          throw path.buildCodeFrameError(
            'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
          );
        }
        const [pendingPath, errorPath, content] = children as [
          NodePath<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer>,
          NodePath<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer>,
          NodePath<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer>,
        ];
        if (!pendingPath.isJSXElement() || !errorPath.isJSXElement()) {
          throw path.buildCodeFrameError(
            'memo-dom: Group children one and two must be Pending and Error declarations',
          );
        }
        const pending = componentPolicy(
          pendingPath,
          ctx.transparentPendingPolicies,
          'Pending',
        );
        const error = componentPolicy(
          errorPath,
          ctx.transparentErrorPolicies,
          'Error',
        );
        const data = groupDataNames(path);
        const origins = groupOrigins(
          ctx,
          path.node as unknown as BaseNode,
          data,
        );
        annotateGroupComponentCalls(
          ctx,
          content.node as unknown as BaseNode,
          origins,
          pending,
          error,
        );
        const visit = (container: NodePath<t.JSXExpressionContainer>): void => {
          if (container.parentPath.isJSXAttribute()) return;
          const expression = container.get('expression');
          if (Array.isArray(expression) || !expression.isExpression()) return;
          if (isLoweredGroupExpression(expression.node)) {
            container.skip();
            return;
          }
          const used = expressionOrigins(
            ctx,
            expression.node as unknown as BaseNode,
            origins,
          );
          if (used.size === 0) return;
          wrapGroupSite(ctx, expression, [...used], pending, error);
          container.skip();
        };
        if (content.isJSXExpressionContainer()) visit(content);
        content.traverse({ JSXExpressionContainer: visit });
        ctx.usesTransparentData = true;
        // Move the authored content node so Group's internal lowering markers
        // survive into the later transparent-read pass.
        path.replaceWith(content.node);
      },
    },
  });
}

/**
 * Source holders are externally changing roots for derivation analysis, but
 * unlike arbitrary opaque values they are push-owned and require no volatile
 * frame polling.
 */
export function registerTransparentSourceRoots(ctx: Ctx): void {
  for (const [component, sources] of ctx.transparentSources) {
    let roots = ctx.opaqueBindings.get(component);
    if (roots === undefined) {
      roots = new Set();
      ctx.opaqueBindings.set(component, roots);
    }
    for (const source of sources) roots.add(source);
  }
}

/**
 * RFC §16.4: lower module-scope transparent declarations into lazy
 * descriptions + stable refs. The description never executes at module
 * evaluation; the first read inside an ApplicationRuntime materializes a
 * request-local instance.
 */
export function scanAndLowerModuleSourceDeclarations(
  ctx: Ctx,
  programPath: { node: t.Program },
): void {
  refreshAstAnalysis(ctx, programPath.node);
  for (const statement of programPath.node.body.slice()) {
    const sourceDescriptions: t.Statement[] = [];
    const requestInputEffects: t.Statement[] = [];
    const inner = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!t.isVariableDeclaration(inner)) continue;
    for (const declarator of inner.declarations) {
      if (!t.isIdentifier(declarator.id)) continue;
      if (!t.isCallExpression(declarator.init)) continue;
      if (!t.isIdentifier(declarator.init.callee)) continue;
      if (!ctx.transparentSourceFactories.has(declarator.init.callee.name)) {
        continue;
      }
      const binding = astBindingAt(
        ctx,
        declarator.init,
        declarator.init.callee.name,
      );
      if (binding?.kind !== 'import') continue;

      const name = declarator.id.name;
      const key = `${ctx.moduleId}#${name}`;
      ctx.transparentModuleSources.set(name, key);
      ctx.usesTransparentData = true;

      const target = declarator.init.arguments[0];
      const options = declarator.init.arguments[1];
      let readsProgramBinding = false;
      const noteProgramReads = (input: t.Node | undefined): void => {
        if (input === undefined) return;
        walkAst(input as unknown as BaseNode, {
          enter(node) {
            if (
              node.type === 'Identifier' &&
              astBindingAt(
                ctx,
                node,
                (node as unknown as AstIdentifier).name,
              )?.scope.isProgramScope === true
            ) {
              readsProgramBinding = true;
            }
          },
        });
      };
      noteProgramReads(t.isNode(target) ? target : undefined);
      noteProgramReads(t.isNode(options) ? options : undefined);
      if (readsProgramBinding) {
        requestInputEffects.push(
          t.expressionStatement(
            t.callExpression(t.identifier('effect'), [
              t.arrowFunctionExpression(
                [],
                t.callExpression(mdd(ctx, 'rebindModuleSource'), [
                  t.callExpression(mdd(ctx, 'sourceRef'), [
                    t.stringLiteral(key),
                  ]),
                  target === undefined
                    ? t.nullLiteral()
                    : t.cloneNode(target, true),
                  ...(options === undefined
                    ? []
                    : [t.cloneNode(options, true)]),
                ]),
              ),
            ]),
          ),
        );
      }
      declarator.init = t.callExpression(mdd(ctx, 'sourceRef'), [
        t.stringLiteral(key),
      ]);
      sourceDescriptions.push(
        t.expressionStatement(
          t.callExpression(mdd(ctx, 'describeModuleSource'), [
            t.stringLiteral(key),
            t.arrowFunctionExpression(
              [],
              t.blockStatement([
                t.returnStatement(
                  t.callExpression(mdd(ctx, 'createSource'), [
                    target === undefined
                      ? t.nullLiteral()
                      : t.cloneNode(target),
                    ...(options === undefined ? [] : [t.cloneNode(options)]),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      );
    }
    if (sourceDescriptions.length > 0) {
      // Keep descriptions in the program so server cell lowering can rewrite
      // reactive request inputs to request-owned reads before final emission.
      const index = programPath.node.body.indexOf(statement);
      if (index !== -1) {
        programPath.node.body.splice(index, 0, ...sourceDescriptions);
      }
    }
    if (requestInputEffects.length > 0) {
      const index = programPath.node.body.indexOf(statement);
      if (index !== -1) {
        programPath.node.body.splice(index + 1, 0, ...requestInputEffects);
      }
    }
  }
}

function importedProgramBinding(
  ctx: Ctx,
  component: BaseNode,
  name: string,
): AstBinding | undefined {
  const binding = astBindingAt(ctx, component, name);
  return binding?.kind === 'import' ? binding : undefined;
}

function isCallToImported(
  ctx: Ctx,
  component: BaseNode,
  call: t.Expression | null | undefined,
  names: ReadonlySet<string>,
): boolean {
  if (!t.isCallExpression(call) || !t.isIdentifier(call.callee)) return false;
  if (!names.has(call.callee.name)) return false;
  return importedProgramBinding(ctx, component, call.callee.name) !== undefined;
}

/** Find direct component-local source declarations and track aliases. */
export function scanTransparentSourceBindings(ctx: Ctx): void {
  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const sources = new Set<string>();
    const trackCandidates: Array<{
      name: string;
      argument: t.CallExpression['arguments'][number] | undefined;
    }> = [];
    for (const statement of componentPath.node.body.body) {
      if (!t.isVariableDeclaration(statement)) continue;
      for (const declaration of statement.declarations) {
        if (!t.isIdentifier(declaration.id)) continue;
        const init = declaration.init;
        if (!t.isCallExpression(init)) continue;
        if (
          isCallToImported(
            ctx,
            componentNode,
            init,
            ctx.transparentSourceFactories,
          )
        ) {
          sources.add(declaration.id.name);
          continue;
        }
        if (
          isCallToImported(
            ctx,
            componentNode,
            init,
            ctx.transparentTrackFactories,
          )
        ) {
          trackCandidates.push({
            name: declaration.id.name,
            argument: init.arguments[0],
          });
        }
      }
    }
    // Imported module-scope sources (RFC §16.4) referenced anywhere in the
    // component join the holder set: runtime helpers accept ModuleSourceRef
    // uniformly, and registering them here is what makes emission attach
    // subscription/ownership mounts so commits push-invalidate the entity
    // (without this, plain gated reads never re-render after commit).
    if (ctx.transparentModuleSources.size > 0) {
      walkAst(componentNode, {
        enter(node) {
          if (node.type !== 'Identifier') return;
          const identifier = node as unknown as AstIdentifier;
          const name = identifier.name;
          if (!ctx.transparentModuleSources.has(name)) return;
          const binding = astBindingAt(ctx, node, name);
          if (binding === undefined || !binding.references.includes(identifier)) return;
          if (binding.kind !== 'import' && !binding.scope.isProgramScope) return;
          sources.add(name);
        },
      });
    }
    const plan = ctx.componentProps.get(component);
    const sourceProps = new Map<string, string>();
    for (const [prop, origin] of ctx.linkedComponentPropSources.get(component) ?? []) {
      if (origin.transparent !== true || plan === undefined) continue;
      const binding = localBindingForProp(plan, prop);
      if (binding !== null) {
        sources.add(binding);
        sourceProps.set(binding, prop);
      }
    }
    if (sourceProps.size > 0) {
      ctx.transparentSourceProps.set(component, sourceProps);
      ctx.transparentPolicyParams.set(
        component,
        generatedIdentifier(ctx, 'dataPolicies'),
      );
    }
    if (sources.size === 0) continue;
    ctx.usesTransparentData = true;
    ctx.transparentSources.set(component, sources);
    const tracks = new Map<string, readonly string[]>();
    for (const candidate of trackCandidates) {
      const found = new Set<string>();
      if (t.isIdentifier(candidate.argument) && sources.has(candidate.argument.name)) {
        found.add(candidate.argument.name);
      } else if (t.isObjectExpression(candidate.argument)) {
        for (const property of candidate.argument.properties) {
          if (t.isObjectProperty(property) && t.isIdentifier(property.value)) {
            if (sources.has(property.value.name)) found.add(property.value.name);
          }
        }
      }
      if (found.size > 0) tracks.set(candidate.name, [...found].sort());
    }
    if (tracks.size > 0) ctx.transparentTrackBindings.set(component, tracks);
  }
}

function isBoundTo(
  path: NodePath<t.Identifier>,
  binding: Binding,
): boolean {
  return path.scope.getBinding(path.node.name) === binding;
}

function jsxAttributeName(attribute: NodePath<t.JSXAttribute>): string {
  const name = attribute.node.name;
  return t.isJSXIdentifier(name)
    ? name.name
    : `${name.namespace.name}:${name.name.name}`;
}

function isEventOrRefContainer(path: NodePath<t.JSXExpressionContainer>): boolean {
  const parent = path.parentPath;
  if (!parent.isJSXAttribute()) return false;
  const name = jsxAttributeName(parent);
  return name === 'ref' || /^on[A-Z]/.test(name);
}

function isComponentPropContainer(path: NodePath<t.JSXExpressionContainer>): boolean {
  const attribute = path.parentPath;
  if (!attribute.isJSXAttribute()) return false;
  const opening = attribute.parentPath;
  return opening.isJSXOpeningElement() &&
    t.isJSXIdentifier(opening.node.name) &&
    /^[A-Z]/.test(opening.node.name.name);
}

function isDirectSourceComponentProp(
  path: NodePath<t.JSXExpressionContainer>,
  bindings: ReadonlyMap<string, Binding>,
): boolean {
  if (!isComponentPropContainer(path)) return false;
  const expression = path.get('expression');
  if (Array.isArray(expression) || !expression.isReferencedIdentifier()) {
    return false;
  }
  const identifier = expression as NodePath<t.Identifier>;
  const binding = bindings.get(identifier.node.name);
  return binding !== undefined && isBoundTo(identifier, binding);
}

function isWithinDirectSourceComponentProp(
  path: NodePath<t.Identifier>,
  bindings: ReadonlyMap<string, Binding>,
): boolean {
  const container = path.parentPath;
  if (!container.isJSXExpressionContainer() || container.node.expression !== path.node) {
    return false;
  }
  return isDirectSourceComponentProp(container, bindings);
}

function isGroupDataContainer(path: NodePath<t.JSXExpressionContainer>): boolean {
  const attribute = path.parentPath;
  if (!attribute.isJSXAttribute() || jsxAttributeName(attribute) !== 'data') {
    return false;
  }
  const opening = attribute.parentPath;
  return (
    opening.isJSXOpeningElement() &&
    t.isJSXIdentifier(opening.node.name, { name: 'Group' })
  );
}

function isWithinGroupData(path: NodePath): boolean {
  const container = path.findParent((parent) =>
    parent.isJSXExpressionContainer(),
  );
  return container?.isJSXExpressionContainer() === true &&
    isGroupDataContainer(container);
}

function callRootName(call: NodePath<t.CallExpression>): string | null {
  return t.isIdentifier(call.node.callee) ? call.node.callee.name : null;
}

function isPassthroughArgument(
  ctx: Ctx,
  path: NodePath<t.Identifier>,
): boolean {
  const parent = path.parentPath;
  if (!parent.isCallExpression()) return false;
  if (!parent.node.arguments.includes(path.node)) return false;
  const root = callRootName(parent);
  return root !== null && ctx.transparentSourcePassthroughs.has(root);
}

function isActionRefreshTarget(path: NodePath<t.Identifier>): boolean {
  const array = path.findParent((parent) => parent.isArrayExpression());
  if (array === null || !array.isArrayExpression()) return false;
  const property = array.parentPath;
  if (!property.isObjectProperty() || property.node.value !== array.node) {
    return false;
  }
  const key = property.node.key;
  return (
    (!property.node.computed && t.isIdentifier(key, { name: 'refresh' })) ||
    t.isStringLiteral(key, { value: 'refresh' })
  );
}

function isGeneratedDataCall(ctx: Ctx, path: NodePath): boolean {
  const call = path.findParent((parent) => parent.isCallExpression());
  if (call === null || !call.isCallExpression()) return false;
  const callee = call.node.callee;
  return (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    })
  );
}

function sourceBindings(
  componentPath: NodePath<t.FunctionDeclaration>,
  names: ReadonlySet<string>,
): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const name of names) {
    const binding = componentPath.scope.getBinding(name);
    if (binding !== undefined) bindings.set(name, binding);
  }
  return bindings;
}

function sourceDependencies(
  ctx: Ctx,
  path: NodePath,
  bindings: ReadonlyMap<string, Binding>,
  derived: ReadonlyMap<
    string,
    { binding: Binding; sources: readonly string[]; expression: t.Expression }
  >,
): string[] {
  const found = new Set<string>();
  const note = (identifier: NodePath<t.Identifier>): void => {
    const binding = bindings.get(identifier.node.name);
    if (binding !== undefined && isBoundTo(identifier, binding)) {
      if (!isPassthroughArgument(ctx, identifier)) {
        found.add(identifier.node.name);
      }
      return;
    }
    const derivation = derived.get(identifier.node.name);
    if (
      derivation !== undefined &&
      isBoundTo(identifier, derivation.binding)
    ) {
      for (const source of derivation.sources) found.add(source);
    }
  };
  if (path.isReferencedIdentifier()) note(path as NodePath<t.Identifier>);
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (!identifier.isIdentifier()) return;
      note(identifier as NodePath<t.Identifier>);
    },
  });
  return [...found].sort();
}

function replaceDerivedReads(
  path: NodePath,
  derived: ReadonlyMap<
    string,
    { binding: Binding; sources: readonly string[]; expression: t.Expression }
  >,
): void {
  const replace = (identifier: NodePath<t.Identifier>): void => {
    const projection = derived.get(identifier.node.name);
    if (
      projection === undefined ||
      !isBoundTo(identifier, projection.binding)
    ) return;
    identifier.replaceWith(t.cloneNode(projection.expression, true));
    identifier.skip();
  };
  if (path.isReferencedIdentifier()) replace(path as NodePath<t.Identifier>);
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (identifier.isIdentifier()) replace(identifier as NodePath<t.Identifier>);
    },
  });
}

function trackDependencies(
  path: NodePath,
  componentPath: NodePath<t.FunctionDeclaration>,
  tracks: ReadonlyMap<string, readonly string[]>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: NodePath<t.Identifier>): void => {
    const sources = tracks.get(identifier.node.name);
    if (sources === undefined) return;
    const binding = componentPath.scope.getBinding(identifier.node.name);
    if (binding === undefined || !isBoundTo(identifier, binding)) return;
    for (const source of sources) found.add(source);
  };
  if (path.isReferencedIdentifier()) note(path as NodePath<t.Identifier>);
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (identifier.isIdentifier()) note(identifier as NodePath<t.Identifier>);
    },
  });
  return [...found].sort();
}

function replaceSourceReads(
  ctx: Ctx,
  path: NodePath,
  bindings: ReadonlyMap<string, Binding>,
  replacements: ReadonlyMap<string, t.Identifier>,
): void {
  const replace = (identifier: NodePath<t.Identifier>): void => {
    const binding = bindings.get(identifier.node.name);
    const replacement = replacements.get(identifier.node.name);
    if (
      binding === undefined ||
      replacement === undefined ||
      !isBoundTo(identifier, binding) ||
      isPassthroughArgument(ctx, identifier)
    ) {
      return;
    }
    identifier.replaceWith(t.cloneNode(replacement));
  };
  if (path.isReferencedIdentifier()) replace(path as NodePath<t.Identifier>);
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (!identifier.isIdentifier()) return;
      replace(identifier as NodePath<t.Identifier>);
    },
  });
}

/**
 * Render-site semantics for authored control flow: source reads become
 * render-gated (unavailable renders empty, initial failure stays loud) so
 * state-driven branches evaluate immediately while payload sinks self-gate.
 */
function replaceSourceReadsWithRenderGates(
  ctx: Ctx,
  path: NodePath,
  bindings: ReadonlyMap<string, Binding>,
): void {
  // Collect first, replace after — the replacement call embeds the same
  // identifier, so replacing during traversal would recurse forever.
  const found: NodePath<t.Identifier>[] = [];
  const note = (identifier: NodePath<t.Identifier>): void => {
    const binding = bindings.get(identifier.node.name);
    if (binding === undefined || !isBoundTo(identifier, binding)) return;
    if (isPassthroughArgument(ctx, identifier)) return;
    found.push(identifier);
  };
  if (path.isReferencedIdentifier()) note(path as NodePath<t.Identifier>);
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (!identifier.isIdentifier()) return;
      note(identifier as NodePath<t.Identifier>);
    },
  });
  for (const identifier of found) {
    identifier.replaceWith(
      t.callExpression(mdd(ctx, 'readResolvedValueForRender'), [
        t.identifier(identifier.node.name),
      ]),
    );
  }
}

/**
 * A read inside a render-gated subtree is already availability-safe — unless
 * it sits inside a nested function (handler/effect), where the imperative R2
 * guard still applies.
 */
function isInsideRenderGate(path: NodePath<t.Identifier>): boolean {
  let current: NodePath | null = path.parentPath;
  while (current !== null) {
    if (
      (current.node as RenderGatedExpression).__memoDomRenderGated === true
    ) {
      return true;
    }
    if (current.isFunction()) return false;
    current = current.parentPath;
  }
  return false;
}

function resolvedRenderExpression(
  ctx: Ctx,
  path: NodePath<t.Expression>,
  dependencies: readonly string[],
  bindings: ReadonlyMap<string, Binding>,
  helper = 'readResolvedValuesForRender',
): t.Expression {
  const replacements = new Map<string, t.Identifier>();
  const parameters = dependencies.map((source) => {
    const parameter = generatedIdentifier(ctx, `${source}Value`);
    replacements.set(source, parameter);
    return t.cloneNode(parameter);
  });
  replaceSourceReads(ctx, path, bindings, replacements);
  return t.callExpression(mdd(ctx, helper), [
    t.arrayExpression(
      dependencies.map((source) => t.identifier(source)),
    ),
    t.arrowFunctionExpression(parameters, t.cloneNode(path.node, true)),
  ]);
}

function containsJsx(path: NodePath): boolean {
  let found = false;
  path.traverse({
    JSXElement(inner) {
      found = true;
      inner.skip();
    },
    JSXFragment(inner) {
      found = true;
      inner.skip();
    },
  });
  return found;
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
/** One module-scope source reference found inside a component body. */
interface ModuleSourceRead {
  entry: { name: string; key: string; binding: Binding };
  path: NodePath<t.Identifier>;
}

function lowerModuleRefReads(
  ctx: Ctx,
  componentPath: NodePath<t.FunctionDeclaration>,
): void {
  const entries: Array<{
    name: string;
    key: string;
    binding: Binding;
  }> = [];
  for (const [name, key] of ctx.transparentModuleSources) {
    const binding = componentPath.scope.getBinding(name);
    if (binding !== undefined) entries.push({ name, key, binding });
  }
  if (entries.length === 0) return;
  ctx.usesTransparentData = true;
  const matches = (path: NodePath<t.Identifier>): boolean => {
    const entry = entries.find((candidate) => candidate.name === path.node.name);
    return (
      entry !== undefined &&
      path.scope.getBinding(path.node.name) === entry.binding
    );
  };
  const entryOf = (path: NodePath<t.Identifier>) =>
    entries.find((candidate) => candidate.name === path.node.name)!;

  const refCall = (key: string): t.Expression =>
    t.callExpression(mdd(ctx, 'sourceRef'), [t.stringLiteral(key)]);

  // Derivation roots are owned by the deriveResolvedValues wrapping in
  // rewriteTransparentDataReads; rewriting them here would nest a throwing
  // read inside the derive closure.
  const derivationDeclarations = new Set(
    [...ctx.compPaths]
      .filter(([, p]) => p === componentPath)
      .flatMap(([name]) => ctx.instanceDerivations.get(name) ?? [])
      .map((derivation) => derivation.declaration),
  );
  const insideDerivationInit = (path: NodePath<t.Identifier>): boolean => {
    let current: NodePath | null = path.parentPath;
    while (current !== null && !current.isStatement()) {
      if (current.isVariableDeclarator()) {
        const statement = current.parentPath;
        return statement !== null && derivationDeclarations.has(statement.node);
      }
      current = current.parentPath;
    }
    return false;
  };

  const isGroupMarked = (expression: NodePath<t.Expression>): boolean =>
    (expression.node as t.Expression & {
      __memoDomTransparentGroup?: boolean;
    }).__memoDomTransparentGroup === true;

  // Render sites.
  componentPath.traverse({
    JSXExpressionContainer(container) {
      if (isEventOrRefContainer(container)) return;
      const expression = container.get('expression');
      if (Array.isArray(expression) || !expression.isExpression()) return;

      const collectReferenced = (): ModuleSourceRead[] => {
        const found: ModuleSourceRead[] = [];
        expression.traverse({
          Identifier(path) {
            if (!path.isReferencedIdentifier() || !matches(path)) return;
            if (isPassthroughArgument(ctx, path)) return;
            found.push({ entry: entryOf(path), path });
          },
        });
        return found;
      };

      if (isGroupMarked(expression)) {
        // Group owns render policy for this generated subtree: pending/error
        // arms and the status-test arrays must survive untouched — they are
        // emitted verbatim and their elements stay source holders (refs),
        // which runtime helpers resolve. Only the committed fragment's user
        // expression is rewritten in place to read through materializing
        // refs (wrapping the whole site would orphan policy JSX).
        const rewriteContainer = (container: NodePath<t.JSXExpressionContainer>): void => {
          const inner = container.get('expression');
          if (Array.isArray(inner) || !inner.isExpression()) return;
          const refs: ModuleSourceRead[] = [];
          inner.traverse({
            Identifier(path) {
              if (!path.isReferencedIdentifier() || !matches(path)) return;
              if (isPassthroughArgument(ctx, path)) return;
              refs.push({ entry: entryOf(path), path });
            },
          });
          for (const { entry, path } of refs) {
            const parent = path.parent;
            const isListReceiver =
              t.isMemberExpression(parent) &&
              parent.object === path.node &&
              !parent.computed &&
              t.isIdentifier(parent.property, { name: 'map' }) &&
              path.parentPath.parentPath?.isCallExpression() === true;
            path.replaceWith(
              t.callExpression(
                mdd(ctx, isListReceiver ? 'readModuleSourceList' : 'readResolvedValueForRender'),
                [refCall(entry.key)],
              ),
            );
            path.skip();
          }
        };
        expression.traverse({
          JSXFragment(fragment) {
            fragment.traverse({
              JSXExpressionContainer(container) {
                if (isEventOrRefContainer(container)) return;
                rewriteContainer(container);
              },
            });
            fragment.skip();
          },
        });
        container.skip();
        return;
      }

      const referenced = collectReferenced();
      if (referenced.length === 0) return;

      // Handle direct .map list receivers first
      for (const { entry, path } of referenced) {
        const parent = path.parent;
        const isListReceiver =
          t.isMemberExpression(parent) &&
          parent.object === path.node &&
          !parent.computed &&
          t.isIdentifier(parent.property, { name: 'map' }) &&
          path.parentPath.parentPath?.isCallExpression() === true;
        if (!isListReceiver) continue;
        path.replaceWith(
          t.callExpression(mdd(ctx, 'readModuleSourceList'), [
            refCall(entry.key),
          ]),
        );
        path.skip();
      }

      // If the expression reads module sources in member/compound expressions,
      // wrap with readResolvedValuesForRender so pending data does not crash on property reads.
      const remaining: Array<{
        entry: (typeof entries)[0];
        path: NodePath<t.Identifier>;
      }> = [];
      expression.traverse({
        Identifier(path) {
          if (!path.isReferencedIdentifier() || !matches(path)) return;
          const entry = entryOf(path);
          remaining.push({ entry, path });
        },
      });

      if (remaining.length > 0) {
        if (
          expression.isIdentifier() &&
          matches(expression as NodePath<t.Identifier>)
        ) {
          const entry = entryOf(expression as NodePath<t.Identifier>);
          expression.replaceWith(
            t.callExpression(mdd(ctx, 'readResolvedValueForRender'), [
              refCall(entry.key),
            ]),
          );
        } else {
          const uniqueEntries = [
            ...new Map(remaining.map((r) => [r.entry.name, r.entry])).values(),
          ];
          const replacements = new Map<string, t.Identifier>();
          const params = uniqueEntries.map((e) => {
            const param = generatedIdentifier(ctx, `${e.name}Value`);
            replacements.set(e.name, param);
            return t.cloneNode(param);
          });
          for (const { entry, path } of remaining) {
            const repl = replacements.get(entry.name);
            if (repl !== undefined) path.replaceWith(t.cloneNode(repl));
          }
          expression.replaceWith(
            t.callExpression(mdd(ctx, 'readResolvedValuesForRender'), [
              t.arrayExpression(uniqueEntries.map((e) => refCall(e.key))),
              t.arrowFunctionExpression(
                params,
                t.cloneNode(expression.node, true),
              ),
            ]),
          );
        }
      }

      // Region subscriptions route through the canonical key.
      annotateTransparentSources(expression.node, [
        ...transparentExpressionSources(ctx, expression.node as t.Expression),
      ]);
      container.skip();
    },
  });

  // Imperative sites keep the throwing R2 guard.
  componentPath.traverse({
    Identifier(path) {
      if (!path.isReferencedIdentifier() || !matches(path)) return;
      if (insideDerivationInit(path)) return;
      // Source passthrough helpers receive the ref itself; wrapping their
      // arguments in a resolved read would throw before first commit.
      if (
        isPassthroughArgument(ctx, path) ||
        isActionRefreshTarget(path) ||
        isGeneratedDataCall(ctx, path)
      ) {
        return;
      }
      const entry = entryOf(path);
      const site =
        path.node.loc === null || path.node.loc === undefined
          ? ctx.moduleId
          : `${ctx.moduleId}:${path.node.loc.start.line}:${
              path.node.loc.start.column + 1
            }`;
      path.replaceWith(
        t.callExpression(mdd(ctx, 'readResolvedValue'), [
          t.callExpression(mdd(ctx, 'sourceRef'), [t.stringLiteral(entry.key)]),
          t.stringLiteral(entry.name),
          t.stringLiteral(site),
        ]),
      );
      path.skip();
    },
  });
}

export function rewriteTransparentDataReads(ctx: Ctx): void {
  // Module-scope sources (RFC §16.4): lower refs to materializing reads
  // first so plain sites are safe immediately; derivation roots themselves
  // are skipped by that pass and owned by the derive pass below.
  for (const componentPath of ctx.compPaths.values()) {
    lowerModuleRefReads(ctx, componentPath);
  }
  // Module-scope refs join the same derivation machinery as component-local
  const moduleBinding = (
    componentPath: NodePath<t.FunctionDeclaration>,
    name: string,
  ): Binding | undefined => {
    if (!ctx.transparentModuleSources.has(name)) return undefined;
    const binding = componentPath.scope.getBinding(name);
    return binding?.path.isImportSpecifier() === true ? binding : undefined;
  };

  for (const [component, componentPath] of ctx.compPaths) {
    const localNames =
      ctx.transparentSources.get(component) ?? new Set<string>();
    const bindings = sourceBindings(componentPath, localNames);
    // Seed module-scope source bindings so derivation and container passes
    // treat imported refs like component-local holders (runtime helpers
    // accept ModuleSourceRef uniformly).
    let hasModuleRefs = false;
    for (const name of ctx.transparentModuleSources.keys()) {
      const binding = moduleBinding(componentPath, name);
      if (binding === undefined) continue;
      bindings.set(name, binding);
      hasModuleRefs = true;
    }
    if (localNames.size === 0 && !hasModuleRefs) continue;
    const names = localNames;
    const tracks = ctx.transparentTrackBindings.get(component) ?? new Map();
    const derived = new Map<
      string,
      {
        binding: Binding;
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
      const declaration = componentPath
        .get('body')
        .get('body')
        .find((statement) => statement.node === derivation.declaration);
      if (declaration?.isVariableDeclaration() !== true) continue;
      const target = declaration.get('declarations').find(
        (candidate) => candidate.node.init !== null &&
          Object.keys(t.getBindingIdentifiers(candidate.node.id)).some(
            (name) => derivation.bindings.includes(name),
          ),
      );
      const init = target?.get('init');
      if (init === undefined || Array.isArray(init) || !init.isExpression()) {
        continue;
      }
      replaceDerivedReads(init, derived);
      const projection = t.cloneNode(init.node, true);
      const wrapped = resolvedRenderExpression(
        ctx,
        init,
        sources,
        bindings,
        'deriveResolvedValues',
      );
      init.replaceWith(wrapped);
      derivation.source = t.cloneNode(wrapped, true);
      for (const name of derivation.bindings) {
        const binding = componentPath.scope.getBinding(name);
        if (binding !== undefined) {
          derived.set(name, {
            binding,
            sources,
            expression: t.cloneNode(projection, true),
          });
        }
      }
    }

    componentPath.traverse({
      JSXExpressionContainer(container) {
        if (
          isEventOrRefContainer(container) ||
          isGroupDataContainer(container) ||
          isDirectSourceComponentProp(container, bindings)
        ) {
          return;
        }
        const expression = container.get('expression');
        if (Array.isArray(expression) || !expression.isExpression()) return;
        if (
          (expression.node as t.Expression & {
            __memoDomTransparentGroup?: boolean;
          }).__memoDomTransparentGroup === true
        ) {
          // Group already owns render policy for this whole generated subtree.
          // Flatten local derivations so the structural entity can update
          // without replaying the whole component owner.
          replaceDerivedReads(expression, derived);
          container.skip();
          return;
        }
        const dependencies = sourceDependencies(
          ctx,
          expression,
          bindings,
          derived,
        );
        const stateDependencies = trackDependencies(
          expression,
          componentPath,
          tracks,
        );
        if (dependencies.length === 0) {
          if (stateDependencies.length > 0) {
            annotateTransparentSources(expression.node, stateDependencies);
          }
          return;
        }
        const allDependencies = [
          ...new Set([...dependencies, ...stateDependencies]),
        ].sort();
        replaceDerivedReads(expression, derived);
        if (
          containsJsx(expression) ||
          dependencies.some((source) =>
            ctx.transparentSourceProps.get(component)?.has(source) === true
          )
        ) {
          if (stateDependencies.length > 0) {
            // Authored control flow driven by request state (RFC §5):
            // the selector and state arms evaluate immediately; payload
            // sinks self-gate per site instead of hiding behind an
            // availability ladder.
            replaceSourceReadsWithRenderGates(ctx, expression, bindings);
            (expression.node as RenderGatedExpression).__memoDomRenderGated =
              true;
            annotateTransparentSources(expression.node, allDependencies);
            container.skip();
            return;
          }
          wrapAutomaticSite(ctx, component, expression, dependencies);
          container.skip();
          return;
        }
        const resolved = resolvedRenderExpression(
          ctx,
          expression,
          dependencies,
          bindings,
        );
        annotateTransparentSources(resolved, allDependencies);
        expression.replaceWith(resolved);
      },
    });

    componentPath.traverse({
      ReferencedIdentifier(identifier) {
        if (!identifier.isIdentifier()) return;
        const sourceIdentifier = identifier as NodePath<t.Identifier>;
        const binding = bindings.get(sourceIdentifier.node.name);
        if (
          binding === undefined ||
          !isBoundTo(sourceIdentifier, binding)
        ) return;
        if (
          isPassthroughArgument(ctx, sourceIdentifier) ||
          isActionRefreshTarget(sourceIdentifier) ||
          isWithinGroupData(sourceIdentifier) ||
          isWithinDirectSourceComponentProp(sourceIdentifier, bindings) ||
          isInsideRenderGate(sourceIdentifier) ||
          isGeneratedDataCall(ctx, sourceIdentifier)
        ) {
          return;
        }
        const site = sourceIdentifier.node.loc === null || sourceIdentifier.node.loc === undefined
          ? ctx.moduleId
          : `${ctx.moduleId}:${sourceIdentifier.node.loc.start.line}:${sourceIdentifier.node.loc.start.column + 1}`;
        sourceIdentifier.replaceWith(
          t.callExpression(mdd(ctx, 'readResolvedValue'), [
            t.identifier(sourceIdentifier.node.name),
            t.stringLiteral(sourceIdentifier.node.name),
            t.stringLiteral(site),
          ]),
        );
        sourceIdentifier.skip();
      },
    });
  }
}

function policyComponentRenderer(
  ctx: Ctx,
  component: string,
  kind: 'pending' | 'error',
): t.ArrowFunctionExpression {
  const id = generatedIdentifier(ctx, 'dataPolicyId');
  const parent = generatedIdentifier(ctx, 'dataPolicyParent');
  const error = generatedIdentifier(ctx, 'dataPolicyError');
  const retry = generatedIdentifier(ctx, 'dataPolicyRetry');
  const entries = kind === 'error'
    ? [
        { name: 'error', value: t.cloneNode(error) as t.Expression },
        { name: 'retry', value: t.cloneNode(retry) as t.Expression },
      ]
    : [];
  const props = orderCallProps(ctx, component, entries);
  return t.arrowFunctionExpression(
    [
      t.cloneNode(id),
      t.cloneNode(parent),
      ...(kind === 'error' ? [t.cloneNode(error), t.cloneNode(retry)] : []),
    ],
    t.callExpression(t.identifier(component), [
      t.cloneNode(id),
      t.cloneNode(parent),
      ...(props.length > 0 ? [t.arrayExpression(props)] : []),
    ]),
  );
}

function fixedPolicyExpression(
  ctx: Ctx,
  policy: { pending: string; error: string },
): t.ObjectExpression {
  return t.objectExpression([
    t.objectProperty(
      t.identifier('pending'),
      policyComponentRenderer(ctx, policy.pending, 'pending'),
    ),
    t.objectProperty(
      t.identifier('error'),
      policyComponentRenderer(ctx, policy.error, 'error'),
    ),
  ]);
}

/** Private presentation argument supplied to one compiled component call. */
export function transparentCallPolicyArgument(
  ctx: Ctx,
  owner: string,
  element: t.JSXElement,
): t.ObjectExpression | null {
  const entries = new Map<string, t.Expression>();
  for (const [prop, policy] of ctx.transparentGroupCallPolicies.get(element) ?? []) {
    entries.set(prop, fixedPolicyExpression(ctx, policy));
  }
  const inherited = ctx.transparentPolicyParams.get(owner);
  const sourceProps = ctx.transparentSourceProps.get(owner);
  if (inherited !== undefined && sourceProps !== undefined) {
    for (const attribute of element.openingElement.attributes) {
      if (
        !t.isJSXAttribute(attribute) ||
        !t.isJSXIdentifier(attribute.name) ||
        !t.isJSXExpressionContainer(attribute.value) ||
        !t.isIdentifier(attribute.value.expression) ||
        entries.has(attribute.name.name)
      ) continue;
      const ownerProp = sourceProps.get(attribute.value.expression.name);
      if (ownerProp === undefined) continue;
      entries.set(
        attribute.name.name,
        t.optionalMemberExpression(
          t.cloneNode(inherited),
          t.isValidIdentifier(ownerProp)
            ? t.identifier(ownerProp)
            : t.stringLiteral(ownerProp),
          !t.isValidIdentifier(ownerProp),
          true,
        ),
      );
    }
  }
  if (entries.size === 0) return null;
  return t.objectExpression(
    [...entries].map(([prop, value]) =>
      t.objectProperty(
        t.isValidIdentifier(prop) ? t.identifier(prop) : t.stringLiteral(prop),
        value,
        !t.isValidIdentifier(prop),
      )
    ),
  );
}

/** Component-mount statements granting disposal only to locally-created sources. */
export function transparentSourceMounts(
  ctx: Ctx,
  component: string,
  owner: t.Identifier,
): t.Statement[] {
  const transported = ctx.transparentSourceProps.get(component);
  return [...(ctx.transparentSources.get(component) ?? [])]
    .filter((source) => transported?.has(source) !== true)
    .map((source) =>
      t.expressionStatement(
        t.callExpression(md(ctx, 'cleanup'), [
          t.cloneNode(owner),
          t.callExpression(mdd(ctx, 'ownResolvedValue'), [
            t.identifier(source),
          ]),
        ]),
      ),
    );
}

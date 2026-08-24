/**
 * R7 list-site analysis. Emission remains separate from this source-shape
 * validation and deterministic identity planning.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  cloneRuntimeBindingPattern,
  type RuntimeBindingPattern,
} from '../analysis/runtime-pattern';
import { matchRenderCallbackMap } from '../components/render-callbacks';
import {
  attrExpr,
  memberKey,
  memberRootName,
  type Ctx,
  type MapCallExpression,
} from '../context';
import { findConstInitializer, isStaticDerivedListConst } from './static-derived';
import {
  isStaticListExpression,
  isStaticPrimitiveList,
  transparentListExpression,
} from './source-shapes';

type Fail = (message: string) => never;
type ParentRow = Pick<
  MapSite,
  'itemParam' | 'sourceKey' | 'sourceLocal'
>;

export interface MapSite {
  /** Reactive source key (e.g. 'items' or 'store.todos'). */
  sourceKey: string;
  /** Ordered source expression, cloned into the reconcile calls. */
  sourceExpr: t.Expression;
  /** Optional-chain maps render no rows while their source is nullish. */
  optional: boolean;
  /** Instance roots invalidate their owner directly, not an access table. */
  sourceLocal: boolean;
  /** Runtime callback target, including supported destructuring patterns. */
  itemPattern: RuntimeBindingPattern;
  /** Representative item binding used by row mutation analysis. */
  itemParam: string;
  /** Optional callback index param name. */
  indexParam: string | null;
  /** Key expression if key={...} was given, else null. */
  keyExpr: t.Expression | null;
  /** Row JSX element, absent for a delegated render callback. */
  jsx: t.JSXElement | null;
  /** Component/host JSX or a caller-owned delegated row factory. */
  form: 'component' | 'inline' | 'callback';
  /** Component name when form === 'component'. */
  rowComp: string | null;
  /** Callback prop invoked when form === 'callback'. */
  renderCallback: t.Expression | null;
  /** Owning component name. */
  owner: string;
  /** Source key or source key plus a source-order occurrence suffix. */
  suffix: string;
  /** Unique site key '<owner>/<suffix>'. */
  prefix: string;
}

interface SourcePlan {
  expression: t.Expression;
  key: string;
  local: boolean;
  suffixBase: string;
}

interface CallbackPlan {
  itemPattern: RuntimeBindingPattern;
  itemParam: string;
  indexParam: string | null;
  jsx: t.JSXElement | null;
  renderInvocation: ReturnType<typeof matchRenderCallbackMap>;
}

interface RowPlan {
  form: MapSite['form'];
  rowComp: string | null;
  renderCallback: t.Expression | null;
}

function compilerResolvedRoots(ctx: Ctx, expression: t.Expression): string[] {
  const current = transparentListExpression(expression);
  if (
    t.isCallExpression(current) &&
    t.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    t.isIdentifier(current.callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    }) &&
    t.isIdentifier(current.callee.property)
  ) {
    if (
      current.callee.property.name === 'readResolvedValue' &&
      t.isIdentifier(current.arguments[0])
    ) {
      return [current.arguments[0].name];
    }
    if (
      (current.callee.property.name === 'readResolvedValuesForRender' ||
        current.callee.property.name === 'deriveResolvedValues') &&
      t.isArrayExpression(current.arguments[0])
    ) {
      return current.arguments[0].elements
        .filter((element): element is t.Identifier => t.isIdentifier(element))
        .map((element) => element.name);
    }
  }
  if (
    t.isCallExpression(current) &&
    (t.isMemberExpression(current.callee) ||
      t.isOptionalMemberExpression(current.callee)) &&
    t.isExpression(current.callee.object)
  ) {
    return compilerResolvedRoots(ctx, current.callee.object);
  }
  if (
    (t.isMemberExpression(current) ||
      t.isOptionalMemberExpression(current)) &&
    t.isExpression(current.object)
  ) {
    return compilerResolvedRoots(ctx, current.object);
  }
  return [];
}

/** Is this expression a `.map(...)` call, including optional chains? */
export function matchMapCall(expr: t.Node): MapCallExpression | null {
  if (!t.isCallExpression(expr) && !t.isOptionalCallExpression(expr)) {
    return null;
  }
  const callee = expr.callee;
  return (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    !callee.computed &&
    t.isIdentifier(callee.property, { name: 'map' })
    ? expr
    : null;
}

/** Does a subtree contain JSX? */
export function containsJsx(path: NodePath): boolean {
  let found = false;
  path.traverse({
    JSXElement() {
      found = true;
    },
    JSXFragment() {
      found = true;
    },
  });
  return found;
}

/**
 * Validate and describe a map site. Analysis and emission walk sites in the
 * same source order so their deterministic suffixes remain identical.
 */
export function analyzeMapSite(
  ctx: Ctx,
  call: MapCallExpression,
  errorAt: Pick<NodePath, 'buildCodeFrameError'>,
  ownerName: string,
  usedPrefixes: Map<string, number>,
  parentRow?: ParentRow,
): MapSite {
  const fail: Fail = (message) => {
    throw errorAt.buildCodeFrameError(message);
  };
  const callee = call.callee as t.MemberExpression | t.OptionalMemberExpression;
  const source = analyzeSource(
    ctx,
    callee.object,
    ownerName,
    parentRow,
    fail,
  );
  const callback = analyzeCallback(ctx, call, ownerName, fail);
  const row = analyzeRow(ctx, callback, fail);
  const suffix = nextSuffix(source.suffixBase, usedPrefixes);

  return {
    sourceKey: source.key,
    sourceExpr: t.cloneNode(source.expression),
    optional:
      t.isOptionalCallExpression(call) ||
      containsOptionalMember(callee.object),
    sourceLocal: source.local,
    itemPattern: callback.itemPattern,
    itemParam: callback.itemParam,
    indexParam: callback.indexParam,
    keyExpr: extractKey(callback.jsx?.openingElement ?? null, fail),
    jsx: callback.jsx,
    form: row.form,
    rowComp: row.rowComp,
    renderCallback: row.renderCallback,
    owner: ownerName,
    suffix,
    prefix: `${ownerName}/${suffix}`,
  };
}

function analyzeSource(
  ctx: Ctx,
  source: t.Expression | t.Super,
  ownerName: string,
  parentRow: ParentRow | undefined,
  fail: Fail,
): SourcePlan {
  const current = t.isExpression(source)
    ? transparentListExpression(source)
    : source;
  if (t.isIdentifier(current)) {
    return analyzeIdentifierSource(ctx, current, ownerName, fail);
  }
  if (
    t.isCallExpression(current) &&
    t.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    t.isIdentifier(current.callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    }) &&
    t.isIdentifier(current.callee.property, { name: 'readResolvedValue' }) &&
    t.isIdentifier(current.arguments[0])
  ) {
    const source = current.arguments[0];
    return {
      expression: current,
      key: source.name,
      local: true,
      suffixBase: source.name,
    };
  }
  const resolvedRoots = t.isExpression(current)
    ? compilerResolvedRoots(ctx, current)
    : [];
  if (t.isExpression(current) && resolvedRoots.length > 0) {
    const key = resolvedRoots.join('$');
    return {
      expression: current,
      key,
      local: true,
      suffixBase: key,
    };
  }
  if (t.isMemberExpression(current) || t.isOptionalMemberExpression(current)) {
    return analyzeMemberSource(
      ctx,
      current,
      ownerName,
      parentRow,
      fail,
    );
  }
  if (
    t.isExpression(current) &&
    (isStaticPrimitiveList(current) || isStaticListExpression(current))
  ) {
    return {
      expression: current,
      key: '$static-list',
      local: true,
      suffixBase: '$static-list',
    };
  }
  return fail(
    'memo-dom: assign an ordered collection view to reactive state or a local derivation before mapping it',
  );
}

function analyzeIdentifierSource(
  ctx: Ctx,
  source: t.Identifier,
  ownerName: string,
  fail: Fail,
): SourcePlan {
  // A static-derived const (method chain rooted at a primitive array
  // literal) is a frozen value: reconcile the initializer chain directly,
  // no reactive routing. The declaration keyword is irrelevant - the
  // initializer decides. No method enumeration: the chain shape decides.
  if (isStaticDerivedListConst(ctx, source.name, ownerName)) {
    const init = findConstInitializer(ctx, source.name, ownerName);
    if (init !== null) {
      return {
        expression: t.cloneNode(init),
        key: '$static-list',
        local: true,
        suffixBase: '$static-list',
      };
    }
  }
  const propBindings = ctx.componentProps.get(ownerName)?.bindings ?? [];
  const opaqueBindings = ctx.opaqueBindings.get(ownerName);
  const local =
    ctx.instanceState.get(ownerName)?.has(source.name) === true ||
    ctx.instanceDerivedBindings.get(ownerName)?.has(source.name) === true ||
    propBindings.includes(source.name) ||
    opaqueBindings?.has(source.name) === true;
  const kind = ctx.state.get(source.name);
  if (
    !local &&
    kind !== 'let' &&
    kind !== 'const' &&
    kind !== 'computed'
  ) {
    return fail(
      'memo-dom: list views must come from reactive module state, component props, component state, or a local derivation',
    );
  }
  return {
    expression: source,
    key: source.name,
    local,
    suffixBase: source.name,
  };
}

function analyzeMemberSource(
  ctx: Ctx,
  source: t.MemberExpression | t.OptionalMemberExpression,
  ownerName: string,
  parentRow: ParentRow | undefined,
  fail: Fail,
): SourcePlan {
  const root = memberRootName(source);
  const key = memberKey(source);
  const propBindings = ctx.componentProps.get(ownerName)?.bindings ?? [];
  const opaqueBindings = ctx.opaqueBindings.get(ownerName);
  const localRoot =
    root !== null &&
    (ctx.instanceState.get(ownerName)?.has(root) === true ||
      ctx.instanceDerivedBindings.get(ownerName)?.has(root) === true ||
      propBindings.includes(root) ||
      opaqueBindings?.has(root) === true);
  const rowRelative =
    root !== null &&
    key !== null &&
    parentRow !== undefined &&
    root === parentRow.itemParam;

  if (
    root === null ||
    key === null ||
    !key.includes('.') ||
    (!rowRelative && !localRoot && ctx.state.get(root) !== 'store')
  ) {
    return fail(
      'memo-dom: list member views must be a static path on reactive module state, component props, component state, or a local derivation',
    );
  }
  return {
    expression: source,
    key: rowRelative ? parentRow.sourceKey : key,
    local: rowRelative ? parentRow.sourceLocal : localRoot,
    suffixBase: key.slice(key.lastIndexOf('.') + 1),
  };
}

function containsOptionalMember(source: t.Expression | t.Super): boolean {
  let current: t.Expression | t.Super = source;
  while (!t.isSuper(current)) {
    if (t.isOptionalMemberExpression(current)) return true;
    if (!t.isMemberExpression(current)) return false;
    current = current.object;
  }
  return false;
}

function analyzeCallback(
  ctx: Ctx,
  call: MapCallExpression,
  ownerName: string,
  fail: Fail,
): CallbackPlan {
  if (
    call.arguments.length !== 1 ||
    !t.isArrowFunctionExpression(call.arguments[0])
  ) {
    return fail(
      'memo-dom: list rendering expects items.map(item => <JSX />) — R7 L1',
    );
  }
  const callback = call.arguments[0];
  const first = callback.params[0];
  const second = callback.params[1];
  if (
    callback.params.length < 1 ||
    callback.params.length > 2 ||
    (!t.isIdentifier(first) &&
      !t.isObjectPattern(first) &&
      !t.isArrayPattern(first)) ||
    (second !== undefined && !t.isIdentifier(second))
  ) {
    return fail(
      'memo-dom: list callback must take an item binding pattern and optional index identifier — R7 L1',
    );
  }

  const itemPattern = cloneRuntimeBindingPattern(first);
  const itemBindings = Object.keys(t.getBindingIdentifiers(itemPattern));
  if (itemBindings.length === 0) {
    return fail(
      'memo-dom: list callback item pattern must bind at least one name — R7 L1',
    );
  }
  const itemParam = t.isIdentifier(itemPattern)
    ? itemPattern.name
    : itemBindings[0]!;
  const indexParam = t.isIdentifier(second) ? second.name : null;
  const jsx = resolveCallbackJsx(callback, itemPattern, indexParam, fail);
  const renderInvocation = matchRenderCallbackMap(ctx, ownerName, call);
  if (jsx === null && renderInvocation === null) {
    return fail(
      'memo-dom: list callback body must be one JSX element, a block containing only return <JSX />, or const derivations followed by return <JSX /> — R7 L1',
    );
  }
  return {
    itemPattern,
    itemParam,
    indexParam,
    jsx,
    renderInvocation,
  };
}

/**
 * Normalize supported callback body shapes to a bare JSX element.
 *
 * A block body of `const` derivations followed by `return <JSX />` is
 * beta-reduced: each derivation initializer is substituted for every
 * reference in the returned JSX (and in later initializers). Reads stay
 * visible to read collection and guarded slots re-evaluate per update, so
 * invalidation and freshness are unchanged; initializers must therefore be
 * pure.
 */
function resolveCallbackJsx(
  callback: t.ArrowFunctionExpression,
  itemPattern: RuntimeBindingPattern,
  indexParam: string | null,
  fail: Fail,
): t.JSXElement | null {
  if (t.isJSXElement(callback.body)) return callback.body;
  if (!t.isBlockStatement(callback.body)) return null;
  const statements = callback.body.body;
  const tail = statements.at(-1);
  if (
    tail === undefined ||
    !t.isReturnStatement(tail) ||
    !t.isJSXElement(tail.argument)
  ) {
    return null;
  }
  const jsx = tail.argument;
  if (statements.length > 1) {
    const reserved = new Set([
      ...Object.keys(t.getBindingIdentifiers(itemPattern)),
      ...(indexParam === null ? [] : [indexParam]),
    ]);
    const derivations = collectRowDerivations(
      statements.slice(0, -1),
      reserved,
      fail,
    );
    assertNoShadowing(jsx, new Set(derivations.map(({ name }) => name)), fail);
    const resolved = new Map<string, t.Expression>();
    for (const derivation of derivations) {
      resolved.set(
        derivation.name,
        substituteRowDerivations(derivation.init, resolved),
      );
    }
    const substituted = substituteRowDerivations(jsx, resolved);
    callback.body = substituted;
    return substituted;
  }
  return jsx;
}

interface RowDerivation {
  name: string;
  init: t.Expression;
}

function collectRowDerivations(
  statements: t.Statement[],
  reserved: ReadonlySet<string>,
  fail: Fail,
): RowDerivation[] {
  const derivations: RowDerivation[] = [];
  for (const statement of statements) {
    const declaration =
      t.isVariableDeclaration(statement) &&
      statement.kind === 'const' &&
      statement.declarations.length === 1
        ? statement.declarations[0]
        : null;
    if (
      declaration === undefined ||
      declaration === null ||
      !t.isIdentifier(declaration.id) ||
      declaration.init == null ||
      !t.isExpression(declaration.init)
    ) {
      return fail(
        'memo-dom: list callback statements before return must be single-name const declarations — R7 L1',
      );
    }
    if (reserved.has(declaration.id.name)) {
      return fail(
        `memo-dom: list callback derivation '${declaration.id.name}' shadows an item or index binding — R7 L1`,
      );
    }
    t.traverseFast(declaration.init, (node) => {
      if (
        t.isAssignmentExpression(node) ||
        t.isUpdateExpression(node) ||
        t.isAwaitExpression(node) ||
        t.isYieldExpression(node)
      ) {
        fail(
          'memo-dom: list callback derivations must be pure const expressions — R7 L1',
        );
      }
    });
    derivations.push({ name: declaration.id.name, init: declaration.init });
  }
  return derivations;
}

function assertNoShadowing(
  root: t.Node,
  names: ReadonlySet<string>,
  fail: Fail,
): void {
  if (names.size === 0) return;
  const checkParams = (params: readonly t.Node[]): void => {
    for (const parameter of params) {
      for (const name of Object.keys(t.getBindingIdentifiers(parameter))) {
        if (names.has(name)) {
          fail(
            `memo-dom: list callback derivation '${name}' is shadowed inside the row JSX — R7 L1`,
          );
        }
      }
    }
  };
  t.traverseFast(root, (node) => {
    if (t.isFunction(node)) {
      checkParams(node.params);
    }
    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      names.has(node.id.name)
    ) {
      fail(
        `memo-dom: list callback derivation '${node.id.name}' is shadowed inside the row JSX — R7 L1`,
      );
    }
  });
}

/**
 * Replace references to resolved derivations throughout an expression.
 * Reference positions are tracked so member property names, object keys,
 * and function parameters keep their identifiers. Every inserted
 * initializer is a fresh deep clone.
 */
function substituteRowDerivations<T extends t.Node>(
  node: T,
  resolved: ReadonlyMap<string, t.Expression>,
): T {
  if (resolved.size === 0) return node;
  return substituteNode(node, resolved, true);
}

function substituteNode<T extends t.Node>(
  node: T,
  resolved: ReadonlyMap<string, t.Expression>,
  reference: boolean,
): T {
  if (t.isIdentifier(node)) {
    if (reference && resolved.has(node.name)) {
      return t.cloneNode(resolved.get(node.name)!, true) as unknown as T;
    }
    return node;
  }
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const next = t.cloneNode(node, false);
    next.object = substituteNode(node.object, resolved, true) as typeof next.object;
    if (node.computed) {
      next.property = substituteNode(
        node.property as t.Expression,
        resolved,
        true,
      ) as typeof next.property;
    }
    return next;
  }
  if (t.isObjectProperty(node) && node.shorthand && t.isIdentifier(node.key)) {
    const next = t.cloneNode(node, false);
    next.value = substituteNode(
      node.value as t.Expression,
      resolved,
      true,
    ) as typeof next.value;
    next.shorthand = false;
    return next;
  }
  if (t.isFunction(node)) {
    const next = t.cloneNode(node, false);
    next.params = node.params.map((parameter) =>
      t.cloneNode(parameter, true),
    );
    next.body = substituteNode(node.body, resolved, true);
    return next;
  }
  const next = t.cloneNode(node, false);
  const source = node as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = source[key];
    if (Array.isArray(child)) {
      target[key] = child.map((entry) =>
        entry === null || typeof entry !== 'object' || !('type' in entry)
          ? entry
          : substituteNode(entry as t.Node, resolved, true),
      );
    } else if (
      child !== null &&
      typeof child === 'object' &&
      'type' in child
    ) {
      target[key] = substituteNode(child as t.Node, resolved, true);
    }
  }
  return next;
}

function analyzeRow(
  ctx: Ctx,
  callback: CallbackPlan,
  fail: Fail,
): RowPlan {
  const opening = callback.jsx?.openingElement ?? null;
  if (opening !== null && !t.isJSXIdentifier(opening.name)) {
    return fail('memo-dom: namespaced JSX tags are not supported (L1)');
  }
  const tag =
    opening !== null && t.isJSXIdentifier(opening.name)
      ? opening.name.name
      : null;
  if (callback.renderInvocation !== null) {
    validateRenderInvocation(callback, fail);
    return {
      form: 'callback',
      rowComp: null,
      renderCallback: t.cloneNode(
        callback.renderInvocation.target,
        true,
      ),
    };
  }
  if (tag !== null && /^[A-Z]/.test(tag)) {
    if (!ctx.comps.has(tag) && !ctx.importedComponents.has(tag)) {
      return fail(`memo-dom: <${tag} /> is not a linked component factory`);
    }
    return {
      form: 'component',
      rowComp: tag,
      renderCallback: null,
    };
  }
  return {
    form: 'inline',
    rowComp: null,
    renderCallback: null,
  };
}

function validateRenderInvocation(
  callback: CallbackPlan,
  fail: Fail,
): void {
  const invocation = callback.renderInvocation!;
  if (
    !t.isIdentifier(callback.itemPattern) ||
    invocation.arguments.length < 1 ||
    invocation.arguments.length > 2 ||
    !t.isIdentifier(invocation.arguments[0], {
      name: callback.itemPattern.name,
    }) ||
    (invocation.arguments.length === 2 &&
      (callback.indexParam === null ||
        !t.isIdentifier(invocation.arguments[1], {
          name: callback.indexParam,
        })))
  ) {
    fail(
      'memo-dom: render callback maps must pass their item and optional index bindings directly',
    );
  }
}

function extractKey(
  opening: t.JSXOpeningElement | null,
  fail: Fail,
): t.Expression | null {
  let key: t.Expression | null = null;
  for (const attribute of opening?.attributes ?? []) {
    if (
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name, { name: 'key' })
    ) {
      key = attrExpr(attribute.value);
      if (key === null) {
        return fail('memo-dom: key={...} needs an expression');
      }
    }
  }
  return key;
}

function nextSuffix(
  sourceKey: string,
  usedPrefixes: Map<string, number>,
): string {
  const seen = usedPrefixes.get(sourceKey) ?? 0;
  usedPrefixes.set(sourceKey, seen + 1);
  return seen === 0 ? sourceKey : `${sourceKey}${seen}`;
}

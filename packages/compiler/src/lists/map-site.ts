/**
 * R7 list-site analysis. Emission remains separate from this source-shape
 * validation and deterministic identity planning.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  ESTREE_VISITOR_KEYS,
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
} from '../ast';
import { cloneRuntimeBindingPattern } from '../analysis/runtime-pattern';
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

type Fail = (message: string, at?: t.Node) => never;
interface ErrorPath {
  buildCodeFrameError(message: string, at?: t.Node): Error;
}
interface NodeHolder {
  node: BaseNode;
}
type RuntimeBindingPattern =
  | t.Identifier
  | t.ObjectPattern
  | t.ArrayPattern;
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

function emptyListWhileUnresolved(
  ctx: Ctx,
  expression: t.Expression,
): t.Expression {
  const current = transparentListExpression(expression);
  if (compilerResolvedRoots(ctx, current).length === 0) return current;
  if (
    astFactory.isLogicalExpression(current) &&
    current.operator === '||' &&
    astFactory.isArrayExpression(current.right) &&
    current.right.elements.length === 0
  ) {
    return current;
  }
  return astFactory.logicalExpression(
    '||',
    current,
    astFactory.arrayExpression([]),
  );
}

function compilerResolvedRoots(ctx: Ctx, expression: t.Expression): string[] {
  const roots = new Set<string>();
  walkAst(transparentListExpression(expression) as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isCallExpression(node)) return;
      const callee = node.callee;
      if (
        !astFactory.isMemberExpression(callee) ||
        callee.computed ||
        !astFactory.isIdentifier(callee.object, {
          name: ctx.identifiers?.dataRuntimeId,
        }) ||
        !astFactory.isIdentifier(callee.property)
      ) return;
      if (
        (callee.property.name === 'readResolvedValue' ||
          callee.property.name === 'readResolvedValueForRender') &&
        astFactory.isIdentifier(node.arguments[0])
      ) {
        roots.add(node.arguments[0].name);
        return;
      }
      if (
        (callee.property.name === 'readResolvedValuesForRender' ||
          callee.property.name === 'deriveResolvedValues') &&
        astFactory.isArrayExpression(node.arguments[0])
      ) {
        for (const element of node.arguments[0].elements) {
          if (astFactory.isIdentifier(element)) roots.add(element.name);
        }
      }
    },
  });
  return [...roots];
}

/** Is this expression a `.map(...)` call, including optional chains? */
export function matchMapCall(expr: t.Node): MapCallExpression | null {
  let current = expr;
  if (current.type === 'ChainExpression') {
    current = (current as t.ChainExpression).expression;
  }
  while (astFactory.isTransparentExpression(current)) {
    current = current.expression;
  }
  if (!astFactory.isCallExpression(current) && !astFactory.isOptionalCallExpression(current)) {
    return null;
  }
  const callee = current.callee;
  return (astFactory.isMemberExpression(callee) || astFactory.isOptionalMemberExpression(callee)) &&
    !callee.computed &&
    astFactory.isIdentifier(callee.property, { name: 'map' })
    ? current
    : null;
}

/** Does a subtree contain JSX? */
export function containsJsx(input: BaseNode | NodeHolder): boolean {
  let found = false;
  const root = 'node' in input ? input.node : input;
  walkAst(root, {
    enter(node) {
      if (found) return false;
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        found = true;
        return false;
      }
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
  errorAt: ErrorPath,
  ownerName: string,
  usedPrefixes: Map<string, number>,
  parentRow?: ParentRow,
): MapSite {
  const fail: Fail = (message, at) => {
    throw errorAt.buildCodeFrameError(message, at);
  };
  const callee = call.callee as t.MemberExpression | t.OptionalMemberExpression;
  const analyzedSource = ctx.analyzedListSources.get(call);
  const source = analyzedSource === undefined
    ? analyzeSource(ctx, callee.object, ownerName, parentRow, fail)
    : {
        expression: astFactory.isExpression(callee.object)
          ? emptyListWhileUnresolved(ctx, callee.object)
          : fail(
              'memo-dom: list source must be an expression',
              callee.object,
            ),
        ...analyzedSource,
      };
  if (analyzedSource === undefined) {
    ctx.analyzedListSources.set(call, {
      key: source.key,
      local: source.local,
      suffixBase: source.suffixBase,
    });
  }
  const callback = analyzeCallback(ctx, call, ownerName, fail);
  const row = analyzeRow(ctx, callback, fail);
  const suffix = nextSuffix(source.suffixBase, usedPrefixes);
  const calleeShape = callee as unknown as { type: string; optional?: boolean };

  return {
    sourceKey: source.key,
    sourceExpr: cloneEstreeNode(source.expression),
    optional:
      astFactory.isOptionalCallExpression(call) ||
      calleeShape.type === 'OptionalMemberExpression' ||
      calleeShape.optional === true ||
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
  const current = astFactory.isExpression(source)
    ? transparentListExpression(source)
    : source;
  if (astFactory.isIdentifier(current)) {
    return analyzeIdentifierSource(ctx, current, ownerName, fail);
  }
  if (
    astFactory.isCallExpression(current) &&
    astFactory.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    astFactory.isIdentifier(current.callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    }) &&
    astFactory.isIdentifier(current.callee.property, {
      name: 'readModuleSourceList',
    })
  ) {
    // Emitted forms: readModuleSourceList("key") (legacy) and
    // readModuleSourceList(_MDD.sourceRef("key")) (current RFC §16.4
    // lowering — identity is the key itself, matching data-sources.ts).
    const argument = current.arguments[0];
    const key = astFactory.isStringLiteral(argument)
      ? argument.value
      : astFactory.isCallExpression(argument) &&
          astFactory.isMemberExpression(argument.callee) &&
          astFactory.isIdentifier(argument.callee.property, { name: 'sourceRef' }) &&
          astFactory.isStringLiteral(argument.arguments[0])
        ? argument.arguments[0].value
        : null;
    if (key !== null) {
      return {
        expression: current,
        key,
        local: true,
        suffixBase: key,
      };
    }
  }
  if (
    astFactory.isCallExpression(current) &&
    astFactory.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    astFactory.isIdentifier(current.callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    }) &&
    astFactory.isIdentifier(current.callee.property) &&
    (current.callee.property.name === 'readResolvedValue' ||
      current.callee.property.name === 'readResolvedValueForRender') &&
    astFactory.isIdentifier(current.arguments[0])
  ) {
    const source = current.arguments[0];
    const renderGated =
      current.callee.property.name === 'readResolvedValueForRender';
    return {
      // Render-gated sources yield no rows while unavailable (§10: no
      // Group → empty local region); the imperative form stays loud.
      expression: renderGated
        ? emptyListWhileUnresolved(ctx, current)
        : current,
      key: source.name,
      local: true,
      suffixBase: source.name,
    };
  }
  const resolvedRoots = astFactory.isExpression(current)
    ? compilerResolvedRoots(ctx, current)
    : [];
  if (astFactory.isExpression(current) && resolvedRoots.length > 0) {
    const key = resolvedRoots.join('$');
    return {
      expression: emptyListWhileUnresolved(ctx, current),
      key,
      local: true,
      suffixBase: key,
    };
  }
  if (astFactory.isMemberExpression(current) || astFactory.isOptionalMemberExpression(current)) {
    return analyzeMemberSource(
      ctx,
      current,
      ownerName,
      parentRow,
      fail,
    );
  }
  if (
    astFactory.isExpression(current) &&
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
    current as t.Node,
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
        expression: cloneEstreeNode(init as unknown as t.Expression),
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
  while (!astFactory.isSuper(current)) {
    const isOptional = astFactory.isOptionalMemberExpression(current);
    if (!astFactory.isMemberExpression(current) && !isOptional) return false;
    const member = current as t.MemberExpression;
    if (isOptional) return true;
    current = member.object;
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
    !astFactory.isArrowFunctionExpression(call.arguments[0])
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
    (!astFactory.isIdentifier(first) &&
      !astFactory.isObjectPattern(first) &&
      !astFactory.isArrayPattern(first)) ||
    (second !== undefined && !astFactory.isIdentifier(second))
  ) {
    return fail(
      'memo-dom: list callback must take an item binding pattern and optional index identifier — R7 L1',
    );
  }

  const itemPattern = cloneRuntimeBindingPattern(first);
  const itemBindings = extractPatternIdentifiers(
    itemPattern as unknown as BaseNode,
  ).map((identifier) => identifier.name);
  if (itemBindings.length === 0) {
    return fail(
      'memo-dom: list callback item pattern must bind at least one name — R7 L1',
    );
  }
  const itemParam = astFactory.isIdentifier(itemPattern)
    ? itemPattern.name
    : itemBindings[0]!;
  const indexParam = astFactory.isIdentifier(second) ? second.name : null;
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
  if (astFactory.isJSXElement(callback.body)) return callback.body;
  if (!astFactory.isBlockStatement(callback.body)) return null;
  const statements = callback.body.body;
  const tail = statements.at(-1);
  if (
    tail === undefined ||
    !astFactory.isReturnStatement(tail) ||
    !astFactory.isJSXElement(tail.argument)
  ) {
    return null;
  }
  const jsx = tail.argument;
  if (statements.length > 1) {
    const reserved = new Set([
      ...extractPatternIdentifiers(itemPattern as unknown as BaseNode).map(
        (identifier) => identifier.name,
      ),
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

function defaultedRowProjection(
  projection: t.Expression,
  fallback: t.Expression,
): t.Expression {
  return astFactory.conditionalExpression(
    astFactory.binaryExpression(
      '===',
      cloneEstreeNode(projection, true),
      astFactory.unaryExpression('void', astFactory.numericLiteral(0)),
    ),
    cloneEstreeNode(fallback, true),
    projection,
  );
}

function rowMemberProjection(
  source: t.Expression,
  key: t.Expression,
  computed: boolean,
): t.Expression {
  return astFactory.memberExpression(
    cloneEstreeNode(source, true),
    cloneEstreeNode(key, true),
    computed || !astFactory.isIdentifier(key),
  );
}

function decomposeRowPattern(
  pattern: BaseNode,
  source: t.Expression,
  output: RowDerivation[],
  fail: Fail,
): void {
  if (astFactory.isIdentifier(pattern)) {
    output.push({ name: pattern.name, init: source });
    return;
  }
  if (astFactory.isAssignmentPattern(pattern)) {
    decomposeRowPattern(
      pattern.left,
      defaultedRowProjection(source, pattern.right),
      output,
      fail,
    );
    return;
  }
  if (astFactory.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (astFactory.isRestElement(property)) {
        fail(
          'memo-dom: object rest in a list const destructuring declaration is not supported; destructure in the callback parameter or read the required properties explicitly — R7 L1',
        );
      }
      if (!astFactory.isObjectProperty(property)) {
        fail('memo-dom: unsupported list const destructuring property — R7 L1');
      }
      decomposeRowPattern(
        property.value as unknown as BaseNode,
        rowMemberProjection(source, property.key, property.computed),
        output,
        fail,
      );
    }
    return;
  }
  if (astFactory.isArrayPattern(pattern)) {
    for (let index = 0; index < pattern.elements.length; index++) {
      const element = pattern.elements[index];
      if (element === null) continue;
      if (astFactory.isRestElement(element)) {
        if (!astFactory.isIdentifier(element.argument)) {
          fail('memo-dom: nested array rest patterns are not supported in list const destructuring — R7 L1');
        }
        output.push({
          name: element.argument.name,
          init: astFactory.callExpression(
            astFactory.memberExpression(
              cloneEstreeNode(source, true),
              astFactory.identifier('slice'),
            ),
            [astFactory.numericLiteral(index)],
          ),
        });
        continue;
      }
      decomposeRowPattern(
        element as unknown as BaseNode,
        rowMemberProjection(
          source,
          astFactory.numericLiteral(index),
          true,
        ),
        output,
        fail,
      );
    }
    return;
  }
  fail('memo-dom: unsupported list const destructuring target — R7 L1');
}

function collectRowDerivations(
  statements: t.Statement[],
  reserved: ReadonlySet<string>,
  fail: Fail,
): RowDerivation[] {
  const derivations: RowDerivation[] = [];
  for (const statement of statements) {
    const declaration =
      astFactory.isVariableDeclaration(statement) &&
      statement.kind === 'const' &&
      statement.declarations.length === 1
        ? statement.declarations[0]
        : null;
    if (
      declaration === undefined ||
      declaration === null ||
      (!astFactory.isIdentifier(declaration.id) &&
        !astFactory.isObjectPattern(declaration.id) &&
        !astFactory.isArrayPattern(declaration.id)) ||
      declaration.init == null ||
      !astFactory.isExpression(declaration.init)
    ) {
      return fail(
        'memo-dom: list callback statements before return must be one const declaration with an identifier, object pattern, or array pattern — R7 L1',
      );
    }
    walkAst(declaration.init as unknown as BaseNode, {
      enter(node) {
        const current = node as unknown as t.Node;
        if (
          astFactory.isAssignmentExpression(current) ||
          astFactory.isUpdateExpression(current) ||
          astFactory.isAwaitExpression(current) ||
          astFactory.isYieldExpression(current)
        ) {
          fail(
            'memo-dom: list callback derivations must be pure const expressions — R7 L1',
          );
        }
      },
    });
    const expanded: RowDerivation[] = [];
    decomposeRowPattern(
      declaration.id as unknown as BaseNode,
      declaration.init,
      expanded,
      fail,
    );
    for (const derivation of expanded) {
      if (reserved.has(derivation.name)) {
        return fail(
          `memo-dom: list callback derivation '${derivation.name}' shadows an item or index binding — R7 L1`,
        );
      }
      derivations.push(derivation);
    }
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
      for (const { name } of extractPatternIdentifiers(
        parameter as unknown as BaseNode,
      )) {
        if (names.has(name)) {
          fail(
            `memo-dom: list callback derivation '${name}' is shadowed inside the row JSX — R7 L1`,
          );
        }
      }
    }
  };
  walkAst(root as unknown as BaseNode, {
    enter(node) {
      const current = node as unknown as t.Node;
      if (astFactory.isFunction(current)) {
        checkParams(current.params);
      }
      if (
        astFactory.isVariableDeclarator(current) &&
        astFactory.isIdentifier(current.id) &&
        names.has(current.id.name)
      ) {
        fail(
          `memo-dom: list callback derivation '${current.id.name}' is shadowed inside the row JSX — R7 L1`,
        );
      }
    },
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
  if (astFactory.isIdentifier(node)) {
    if (reference && resolved.has(node.name)) {
      return cloneEstreeNode(resolved.get(node.name)!, true) as unknown as T;
    }
    return node;
  }
  if (astFactory.isMemberExpression(node) || astFactory.isOptionalMemberExpression(node)) {
    const next = cloneEstreeNode(node, false);
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
  if (astFactory.isObjectProperty(node) && node.shorthand && astFactory.isIdentifier(node.key)) {
    const next = cloneEstreeNode(node, false);
    next.value = substituteNode(
      node.value as t.Expression,
      resolved,
      true,
    ) as typeof next.value;
    next.shorthand = false;
    return next;
  }
  if (astFactory.isFunction(node)) {
    const next = cloneEstreeNode(node, false);
    next.params = node.params.map((parameter) =>
      cloneEstreeNode(parameter, true),
    );
    next.body = substituteNode(node.body, resolved, true);
    return next;
  }
  const next = cloneEstreeNode(node, false);
  const source = node as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
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
  if (opening !== null && !astFactory.isJSXIdentifier(opening.name)) {
    return fail('memo-dom: namespaced JSX tags are not supported (L1)');
  }
  const tag =
    opening !== null && astFactory.isJSXIdentifier(opening.name)
      ? opening.name.name
      : null;
  if (callback.renderInvocation !== null) {
    validateRenderInvocation(callback, fail);
    return {
      form: 'callback',
      rowComp: null,
      renderCallback: cloneEstreeNode(
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
    !astFactory.isIdentifier(callback.itemPattern) ||
    invocation.arguments.length < 1 ||
    invocation.arguments.length > 2 ||
    !astFactory.isIdentifier(invocation.arguments[0], {
      name: callback.itemPattern.name,
    }) ||
    (invocation.arguments.length === 2 &&
      (callback.indexParam === null ||
        !astFactory.isIdentifier(invocation.arguments[1], {
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
      astFactory.isJSXAttribute(attribute) &&
      astFactory.isJSXIdentifier(attribute.name, { name: 'key' })
    ) {
      key = attrExpr(attribute.value);
      if (key === null) {
        return fail('memo-dom: key={...} needs an expression', attribute);
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

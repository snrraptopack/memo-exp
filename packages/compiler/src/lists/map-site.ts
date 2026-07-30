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
} from '../context';
import { isStaticPrimitiveList } from './source-shapes';

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

/** Is this expression a `.map(...)` call? */
export function matchMapCall(expr: t.Node): t.CallExpression | null {
  if (!t.isCallExpression(expr)) return null;
  const callee = expr.callee;
  return t.isMemberExpression(callee) &&
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
  call: t.CallExpression,
  errorAt: Pick<NodePath, 'buildCodeFrameError'>,
  ownerName: string,
  usedPrefixes: Map<string, number>,
  parentRow?: ParentRow,
): MapSite {
  const fail: Fail = (message) => {
    throw errorAt.buildCodeFrameError(message);
  };
  const callee = call.callee as t.MemberExpression;
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
  if (t.isIdentifier(source)) {
    return analyzeIdentifierSource(ctx, source, ownerName, fail);
  }
  if (t.isMemberExpression(source)) {
    return analyzeMemberSource(
      ctx,
      source,
      ownerName,
      parentRow,
      fail,
    );
  }
  if (t.isExpression(source) && isStaticPrimitiveList(source)) {
    return {
      expression: source,
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
  const propBindings = ctx.componentProps.get(ownerName)?.bindings ?? [];
  const local =
    ctx.instanceState.get(ownerName)?.has(source.name) === true ||
    ctx.instanceDerivedBindings.get(ownerName)?.has(source.name) === true ||
    propBindings.includes(source.name);
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
  source: t.MemberExpression,
  ownerName: string,
  parentRow: ParentRow | undefined,
  fail: Fail,
): SourcePlan {
  const root = memberRootName(source);
  const key = memberKey(source);
  const propBindings = ctx.componentProps.get(ownerName)?.bindings ?? [];
  const localRoot =
    root !== null &&
    (ctx.instanceState.get(ownerName)?.has(root) === true ||
      propBindings.includes(root));
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
      'memo-dom: list member views must be a static path on reactive module state, component props, or component state',
    );
  }
  return {
    expression: source,
    key: rowRelative ? parentRow.sourceKey : key,
    local: rowRelative ? parentRow.sourceLocal : localRoot,
    suffixBase: key.slice(key.lastIndexOf('.') + 1),
  };
}

function analyzeCallback(
  ctx: Ctx,
  call: t.CallExpression,
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
  const returned =
    t.isBlockStatement(callback.body) &&
    callback.body.body.length === 1 &&
    t.isReturnStatement(callback.body.body[0])
      ? callback.body.body[0].argument
      : null;
  const jsx = t.isJSXElement(callback.body)
    ? callback.body
    : t.isJSXElement(returned)
      ? returned
      : null;
  const renderInvocation = matchRenderCallbackMap(ctx, ownerName, call);
  if (jsx === null && renderInvocation === null) {
    return fail(
      'memo-dom: list callback body must be one JSX element or a block containing only return <JSX /> — R7 L1',
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

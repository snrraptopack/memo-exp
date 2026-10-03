/** Shared list meaning, independent of occurrence IDs and DOM emission. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode as cloneEstreeNode, walkAst, type BaseNode} from '../ast';
import {attrExpr, memberKey, memberRootName, type MapCallExpression, type StateKind} from '../context';
import {planRenderCallbackMap, type RenderCallbackProps} from '../components/render-callbacks';
import {isStaticListExpression, isStaticPrimitiveList, transparentListExpression} from './source-shapes';
import {planListCallback, type ListCallbackPlan} from './callback-plan';
import type {MapSite, ParentRow} from './map-site';

type Fail = (message: string, at?: t.Node) => never;
export interface ListSourceIdentity { readonly key: string; readonly local: boolean; readonly suffixBase: string; }
export interface ListSiteInputs {
  readonly localRoots: ReadonlySet<string>;
  readonly state: ReadonlyMap<string, StateKind>;
  readonly staticDerived: ReadonlyMap<string, t.Expression>;
  readonly components: ReadonlySet<string>;
  readonly callbackProps: RenderCallbackProps;
  /** Compatibility with already lowered transparent-data reads; allocates no runtime names. */
  readonly dataRuntimeId: string | undefined;
}
export interface ListSitePlan extends Readonly<Omit<MapSite, 'owner' | 'suffix' | 'prefix'>> {
  readonly suffixBase: string;
  readonly normalizedBody: t.JSXElement | null;
}
interface SourcePlan extends ListSourceIdentity { expression: t.Expression; }
interface CallbackPlan extends ListCallbackPlan { renderInvocation: ReturnType<typeof planRenderCallbackMap>; }
interface RowPlan { form: MapSite['form']; rowComp: string | null; renderCallback: t.Expression | null; }

export function planListSite(
  inputs: ListSiteInputs, call: MapCallExpression, fail: Fail,
  parentRow?: ParentRow, prepared?: ListCallbackPlan, identity?: ListSourceIdentity,
): ListSitePlan {
  const callee = call.callee as t.MemberExpression | t.OptionalMemberExpression;
  const source = identity === undefined
    ? analyzeSource(inputs, callee.object, parentRow, fail)
    : {expression: astFactory.isExpression(callee.object)
        ? emptyListWhileUnresolved(inputs, callee.object)
        : fail('memo-dom: list source must be an expression', callee.object), ...identity};
  const callback = analyzeCallback(inputs, call, fail, prepared);
  const row = analyzeRow(inputs, callback, fail);
  const key = extractKey(callback.jsx?.openingElement ?? null, fail);
  const calleeShape = callee as unknown as {type: string; optional?: boolean};
  return {
    prelude: [...callback.prelude], sourceKey: source.key, sourceExpr: cloneEstreeNode(source.expression),
    optional: astFactory.isOptionalCallExpression(call) || calleeShape.type === 'OptionalMemberExpression' ||
      calleeShape.optional === true || containsOptionalMember(callee.object),
    sourceLocal: source.local, itemPattern: callback.itemPattern, itemParam: callback.itemParam,
    indexParam: callback.indexParam, keyExpr: key.expr, keyFromSpread: key.fromSpread,
    jsx: callback.jsx, ...row, suffixBase: source.suffixBase, normalizedBody: callback.normalizedBody,
  };
}

function emptyListWhileUnresolved(
  inputs: ListSiteInputs,
  expression: t.Expression,
): t.Expression {
  const current = transparentListExpression(expression);
  if (compilerResolvedRoots(inputs, current).length === 0) return current;
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

function compilerResolvedRoots(inputs: ListSiteInputs, expression: t.Expression): string[] {
  const roots = new Set<string>();
  walkAst(transparentListExpression(expression) as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isCallExpression(node)) return;
      const callee = node.callee;
      if (
        !astFactory.isMemberExpression(callee) ||
        callee.computed ||
        !astFactory.isIdentifier(callee.object, {
          name: inputs.dataRuntimeId,
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

function analyzeSource(
  inputs: ListSiteInputs,
  source: t.Expression | t.Super,
  parentRow: ParentRow | undefined,
  fail: Fail,
): SourcePlan {
  const current = astFactory.isExpression(source)
    ? transparentListExpression(source)
    : source;
  if (astFactory.isIdentifier(current)) {
    return analyzeIdentifierSource(inputs, current, fail);
  }
  if (
    astFactory.isCallExpression(current) &&
    astFactory.isMemberExpression(current.callee) &&
    !current.callee.computed &&
    astFactory.isIdentifier(current.callee.object, {
      name: inputs.dataRuntimeId,
    }) &&
    astFactory.isIdentifier(current.callee.property, {
      name: 'readModuleSourceList',
    })
  ) {
    // Source references carry module-source identity (RFC §16.4).
    const argument = current.arguments[0];
    const key = astFactory.isCallExpression(argument) &&
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
      name: inputs.dataRuntimeId,
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
        ? emptyListWhileUnresolved(inputs, current)
        : current,
      key: source.name,
      local: true,
      suffixBase: source.name,
    };
  }
  const resolvedRoots = astFactory.isExpression(current)
    ? compilerResolvedRoots(inputs, current)
    : [];
  if (astFactory.isExpression(current) && resolvedRoots.length > 0) {
    const key = resolvedRoots.join('$');
    return {
      expression: emptyListWhileUnresolved(inputs, current),
      key,
      local: true,
      suffixBase: key,
    };
  }
  if (astFactory.isMemberExpression(current) || astFactory.isOptionalMemberExpression(current)) {
    return analyzeMemberSource(
      inputs,
      current,
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
  inputs: ListSiteInputs,
  source: t.Identifier,
  fail: Fail,
): SourcePlan {
  // A static-derived const (method chain rooted at a primitive array
  // literal) is a frozen value: reconcile the initializer chain directly,
  // no reactive routing. The declaration keyword is irrelevant - the
  // initializer decides. No method enumeration: the chain shape decides.
  const init = inputs.staticDerived.get(source.name);
  if (init !== undefined) {
    return {expression: cloneEstreeNode(init), key: '$static-list', local: true, suffixBase: '$static-list'};
  }
  const local = inputs.localRoots.has(source.name);
  const kind = inputs.state.get(source.name);
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
  inputs: ListSiteInputs,
  source: t.MemberExpression | t.OptionalMemberExpression,
  parentRow: ParentRow | undefined,
  fail: Fail,
): SourcePlan {
  const root = memberRootName(source);
  const key = memberKey(source);
  const localRoot = root !== null && inputs.localRoots.has(root);
  const rowRelative =
    root !== null &&
    key !== null &&
    parentRow !== undefined &&
    root === parentRow.itemParam;

  if (
    root === null ||
    key === null ||
    !key.includes('.') ||
    (!rowRelative && !localRoot && inputs.state.get(root) !== 'store')
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
  inputs: ListSiteInputs,
  call: MapCallExpression,
  fail: Fail,
  prepared?: ListCallbackPlan,
): CallbackPlan {
  const plan = prepared ?? planListCallback(call, fail);
  const renderInvocation = planRenderCallbackMap(inputs.callbackProps, call);
  if (plan.jsx === null && renderInvocation === null) {
    return fail(
      'memo-dom: list callback body must be one JSX element, a block containing only return <JSX />, or const derivations followed by return <JSX /> — R7 L1',
    );
  }
  return { ...plan, renderInvocation };
}

function analyzeRow(
  inputs: ListSiteInputs,
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
    if (!inputs.components.has(tag)) {
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
): { expr: t.Expression | null; fromSpread: boolean } {
  let key: t.Expression | null = null;
  let sawSpread = false;
  const merged: Array<t.ObjectProperty | t.SpreadElement> = [];
  for (const attribute of opening?.attributes ?? []) {
    if (astFactory.isJSXSpreadAttribute(attribute)) {
      sawSpread = true;
      merged.push(
        astFactory.spreadElement(
          cloneEstreeNode(attribute.argument, true),
        ),
      );
      continue;
    }
    if (
      astFactory.isJSXAttribute(attribute) &&
      astFactory.isJSXIdentifier(attribute.name, { name: 'key' })
    ) {
      key = attrExpr(attribute.value);
      if (key === null) {
        return fail('memo-dom: key={...} needs an expression', attribute);
      }
      merged.push(
        astFactory.objectProperty(astFactory.identifier('key'), key),
      );
    }
  }
  // `key` may arrive through a spread attribute; merge attributes in authored
  // order so last-wins applies across spreads and explicit key={...} alike.
  // The runtime falls back to item identity when the merged key is nullish.
  if (!sawSpread) return { expr: key, fromSpread: false };
  return {
    expr: astFactory.memberExpression(
      astFactory.objectExpression(merged),
      astFactory.identifier('key'),
    ),
    fromSpread: true,
  };
}

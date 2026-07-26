/**
 * lists.ts — R7 list-site analysis (pure: no emission here, see emit.ts).
 *
 * Recognizes `{items.map(item => <JSX/>)}` in JSX child position, validates
 * the L1 form, and computes the deterministic id-prefix each region uses
 * ('<ownerPath>/<sourceKey>'), shared by analysis (pattern generation) and
 * emission (region creation) so table patterns always match runtime ids.
 *
 * L1 form rules (each violation is a clear compile error):
 *   - the mapped view must be reactive module state, instance state, or a
 *     synchronous derivation of either
 *   - single identifier callback param (no destructuring)
 *   - callback body is exactly one JSX element, either
 *       a) a component reference:  <Row key={item.id} item={item} />
 *          — props must not read module state (rows read shared state
 *            directly inside their own JSX; props are for item data)
 *       b) a host element:         <li class={...}>{item.label}</li>
 *          — no nested component references inside
 *   - optional key={expr} on the row root; without it the region keys by
 *     item identity (stable synthetic ids, Imba-style)
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { attrExpr, memberKey, memberRootName, nodeHasJsx, type Ctx } from './context';

export interface MapSite {
  /** Reactive source key (e.g. 'items' or 'store.todos'). */
  sourceKey: string;
  /** Ordered source expression, cloned into the reconcile calls. */
  sourceExpr: t.Expression;
  /** Instance roots invalidate their owner directly, not an access table. */
  sourceLocal: boolean;
  /** Callback param name (e.g. 'item'). */
  itemParam: string;
  /** Key expression if key={...} was given, else null. */
  keyExpr: t.Expression | null;
  /** The row JSX element. */
  jsx: t.JSXElement;
  /** 'component' for <Row/>, 'inline' for a host element. */
  form: 'component' | 'inline';
  /** Component name when form === 'component'. */
  rowComp: string | null;
  /** Owning component's name (patterns expand its full path variants). */
  owner: string;
  /** '<sourceKey>' or '<sourceKey><n>' when one owner maps it twice. */
  suffix: string;
  /** Unique site key '<owner>/<suffix>' (pattern bases come from pathVariants). */
  prefix: string;
}

/** Is this expression a `.map(...)` call? Returns the callee object chain. */
export function matchMapCall(expr: t.Node): t.CallExpression | null {
  if (!t.isCallExpression(expr)) return null;
  const callee = expr.callee;
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.property, { name: 'map' })
  ) {
    return expr;
  }
  return null;
}

/** Does a subtree contain JSX? (path-relative, stops at nothing.) */
export function containsJsx(p: NodePath): boolean {
  let found = false;
  p.traverse({
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
 * Deterministic suffix for a map site ('items', then 'items1', … when one
 * owner maps the same array twice) — the per-owner usedPrefixes map must be
 * walked in source order in BOTH passes so analysis and emission agree.
 */
export function nextSuffix(
  sourceKey: string,
  usedPrefixes: Map<string, number>,
): string {
  const seen = usedPrefixes.get(sourceKey) ?? 0;
  usedPrefixes.set(sourceKey, seen + 1);
  return seen === 0 ? sourceKey : `${sourceKey}${seen}`;
}

/**
 * Validate and describe a map site. `errorAt` is used for code frames.
 * `ownerName` is the owning component's name; `usedPrefixes` is the
 * owner's prefix-dedupe map (see nextSuffix).
 */
export function analyzeMapSite(
  ctx: Ctx,
  call: t.CallExpression,
  errorAt: Pick<NodePath, 'buildCodeFrameError'>,
  ownerName: string,
  usedPrefixes: Map<string, number>,
): MapSite {
  const fail = (msg: string): never => {
    throw errorAt.buildCodeFrameError(msg);
  };

  // -- mapped expression: ordered reactive collection view ----------------
  const callee = call.callee as t.MemberExpression;
  const sourceExpr = callee.object;
  let sourceKey: string;
  let sourceLocal = false;
  let suffixBase: string; // region suffix base (last path segment)
  if (t.isIdentifier(sourceExpr)) {
    const localSource =
      ctx.instanceState.get(ownerName)?.has(sourceExpr.name) === true ||
      ctx.instanceComputeds.get(ownerName)?.has(sourceExpr.name) === true;
    const kind = ctx.state.get(sourceExpr.name);
    // R13: computeds are valid list sources (active.map(…) over a filtered
    // derivation) — the region resyncs when the computed commits downstream
    if (
      !localSource &&
      kind !== 'let' &&
      kind !== 'const' &&
      kind !== 'computed'
    ) {
      return fail(
        'memo-dom: list views must come from reactive module or component state',
      );
    }
    sourceKey = sourceExpr.name;
    sourceLocal = localSource;
    suffixBase = sourceExpr.name;
  } else if (t.isMemberExpression(sourceExpr)) {
    const root = memberRootName(sourceExpr);
    const key = memberKey(sourceExpr);
    const localRoot =
      root !== null &&
      ctx.instanceState.get(ownerName)?.has(root) === true;
    if (
      root === null ||
      key === null ||
      !key.includes('.') ||
      (!localRoot && ctx.state.get(root) !== 'store')
    ) {
      return fail(
        'memo-dom: list member views must be a static path on reactive module or component state',
      );
    }
    sourceKey = key;
    sourceLocal = localRoot;
    suffixBase = key.slice(key.lastIndexOf('.') + 1);
  } else {
    return fail(
      'memo-dom: assign an ordered collection view to reactive state or a local derivation before mapping it',
    );
  }

  // -- callback: single identifier param, JSX body -----------------------
  if (call.arguments.length !== 1 || !t.isArrowFunctionExpression(call.arguments[0])) {
    fail('memo-dom: list rendering expects items.map(item => <JSX />) — R7 L1');
  }
  const cb = call.arguments[0] as t.ArrowFunctionExpression;
  if (cb.params.length !== 1 || !t.isIdentifier(cb.params[0])) {
    fail('memo-dom: list callback must take a single identifier param (item) — R7 L1');
  }
  const itemParam = (cb.params[0] as t.Identifier).name;
  if (!t.isJSXElement(cb.body)) {
    fail('memo-dom: list callback body must be exactly one JSX element — R7 L1');
  }
  const jsx = cb.body as t.JSXElement; // guarded above

  // -- row form -----------------------------------------------------------
  const open = jsx.openingElement;
  if (!t.isJSXIdentifier(open.name)) {
    fail('memo-dom: namespaced JSX tags are not supported (L1)');
  }
  const tag = (open.name as t.JSXIdentifier).name;
  let form: MapSite['form'];
  let rowComp: string | null = null;

  if (/^[A-Z]/.test(tag)) {
    form = 'component';
    rowComp = tag;
    if (!ctx.comps.has(tag) && !ctx.importedComponents.has(tag)) {
      fail(`memo-dom: <${tag} /> is not a linked component factory`);
    }
    // R10: state-reading row props are allowed — the region re-pushes the
    // row's props box on every reconcile that retains it (updateProps)
    for (const attr of open.attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        fail('memo-dom: spread attributes are not supported (L1)');
      }
    }
    if (jsx.children.some((c) => !t.isJSXText(c) || c.value.trim() !== '')) {
      fail(
        'memo-dom: component children on keyed list row calls are not supported yet',
      );
    }
  } else {
    form = 'inline';
    // no nested component references inside inline rows
    const stack: t.Node[] = [...jsx.children];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (t.isJSXElement(n)) {
        const n2 = n.openingElement.name;
        if (t.isJSXIdentifier(n2) && /^[A-Z]/.test(n2.name)) {
          fail(
            `memo-dom: component <${n2.name} /> inside an inline list row — use a component row instead: items.map(item => <Row item={item} />)`,
          );
        }
        stack.push(...n.children);
      } else if (t.isJSXExpressionContainer(n) && t.isExpression(n.expression)) {
        // conditionals inside rows would be nested regions (R8 L1)
        const ex = n.expression;
        if (
          (t.isConditionalExpression(ex) ||
            (t.isLogicalExpression(ex) && (ex.operator === '&&' || ex.operator === '||'))) &&
          nodeHasJsx(ex)
        ) {
          fail(
            'memo-dom: conditionals inside list rows are not supported yet (R8 L1) — hoist the row into a component',
          );
        }
      }
    }
  }

  // -- key extraction -----------------------------------------------------
  let keyExpr: t.Expression | null = null;
  for (const attr of open.attributes) {
    if (t.isJSXSpreadAttribute(attr)) continue;
    const a = attr as t.JSXAttribute;
    if ((a.name as t.JSXIdentifier).name === 'key') {
      keyExpr = attrExpr(a.value);
      if (keyExpr === null) fail('memo-dom: key={...} needs an expression');
    }
  }

  const suffix = nextSuffix(suffixBase, usedPrefixes);
  const prefix = `${ownerName}/${suffix}`;
  return {
    sourceKey,
    sourceExpr: t.cloneNode(sourceExpr),
    sourceLocal,
    itemParam,
    keyExpr,
    jsx,
    form,
    rowComp,
    owner: ownerName,
    suffix,
    prefix,
  };
}

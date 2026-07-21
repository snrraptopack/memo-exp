/**
 * emit.ts — R1–R4 + R7/R8 emission: component functions → entity factories.
 *
 *   R1  factory shape: (id, parent, …props), register before creation
 *   R2  JSX → creation branch with cached node variables (post-order)
 *   R3  dynamic expressions → numbered slots with guarded setters
 *   R4  creation runs the same guarded setters (null cache → first write)
 *   R7  {items.map(item => …)} → createListRegion + row factories
 *   R8  {cond ? <A/> : <B/>}   → createCondRegion + branch factories
 *
 * Emission state is explicit (EmitScope) rather than closure-local so that
 * inline list rows and conditional branches can emit into a NESTED scope:
 * a row/branch is a small factory of its own (own slots, own update),
 * created per item / per swap by its region.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { attrExpr, exprReadsState, md, nodeHasJsx, type Ctx } from './context';
import { analyzeMapSite, matchMapCall, type MapSite } from './lists';
import { analyzeCondSite, matchCond } from './conds';
import { buildHandler } from './handlers';

interface EmitScope {
  slots: string[];
  creation: t.Statement[];
  updaters: Array<() => t.Statement>;
  tagCounters: Map<string, number>;
  childCounts: Map<string, number>;
  /** array name → times mapped in this scope (prefix dedupe, source order). */
  usedPrefixes: Map<string, number>;
  /** R8 region naming: 'when0', 'when1', … (source order, matches analysis). */
  usedConds: { count: number };
  textCounter: number;
  regionCounter: number;
}

function newScope(): EmitScope {
  return {
    slots: [],
    creation: [],
    updaters: [],
    tagCounters: new Map(),
    childCounts: new Map(),
    usedPrefixes: new Map(),
    usedConds: { count: 0 },
    textCounter: 0,
    regionCounter: 0,
  };
}

// ---------------------------------------------------------------------
// shared statement builders
// ---------------------------------------------------------------------

function cacheDecl(slots: string[]): t.Statement {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('$'),
      t.objectExpression(
        slots.map((k) => t.objectProperty(t.stringLiteral(k), t.nullLiteral())),
      ),
    ),
  ]);
}

function updateDecl(updaters: Array<() => t.Statement>): t.Statement {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('update'),
      t.arrowFunctionExpression([], t.blockStatement(updaters.map((u) => u()))),
    ),
  ]);
}

function registerStmt(
  idExpr: t.Expression,
  parentExpr: t.Expression,
  renderExpr: t.Expression = t.identifier('update'),
): t.Statement {
  return t.expressionStatement(
    t.callExpression(md('register'), [
      t.objectExpression([
        t.objectProperty(t.identifier('id'), idExpr),
        t.objectProperty(t.identifier('parent'), parentExpr),
        t.objectProperty(t.identifier('render'), renderExpr),
      ]),
    ]),
  );
}

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

export function transformComponent(
  ctx: Ctx,
  path: NodePath<t.FunctionDeclaration>,
  name: string,
): void {
  const node = path.node;

  // -- find the single top-level JSX return -----------------------------
  const returns: NodePath<t.ReturnStatement>[] = [];
  path.get('body').traverse({
    ReturnStatement(r) {
      returns.push(r);
    },
    Function(f) {
      f.skip(); // returns inside nested functions/handlers don't count
    },
  });
  const topLevel = returns.filter((r) => r.getFunctionParent() === path);
  const jsxTop = topLevel.filter((r) => t.isJSXElement(r.node.argument));
  if (jsxTop.length !== 1 || topLevel.length !== 1) {
    throw path.buildCodeFrameError(
      `memo-dom: component '${name}' must have exactly one top-level JSX return (L1)`,
    );
  }
  const returnStmt = jsxTop[0]!.node;
  const jsx = returnStmt.argument as t.JSXElement;

  // -- emit --------------------------------------------------------------
  const scope = newScope();
  const rootVar = emitElement(ctx, scope, jsx, name, path);

  const kept = node.body.body.filter((s) => s !== returnStmt);

    // -- R10: props box. User params become locals synced from __p ---------
    const propNames: string[] = [];
    for (const p of node.params) {
      if (!t.isIdentifier(p)) {
        throw path.buildCodeFrameError(
          `memo-dom: component '${name}' props must be plain identifier params (R10 L1) — destructure inside the body if needed`,
        );
      }
      propNames.push(p.name);
    }
    if (propNames.length > 0) {
      // re-sync locals from the box at the top of every update
      scope.updaters.unshift(() =>
        t.blockStatement(
          propNames.map((pn, i) =>
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.identifier(pn),
                t.memberExpression(t.identifier('__p'), t.numericLiteral(i), true),
              ),
            ),
          ),
        ),
      );
    }

    // Body order matters: register BEFORE creation so children (created and
    // registered by factory calls inside the creation block) always find
    // their parent in the registry — the M4 parent-first invariant. The
    // update closure only runs post-mount, so closing over node variables
    // declared later in the same scope is safe.
    const body: t.Statement[] = [cacheDecl(scope.slots)];
    if (propNames.length > 0) {
      body.push(
        t.variableDeclaration(
          'let',
          propNames.map((pn, i) =>
            t.variableDeclarator(
              t.identifier(pn),
              t.memberExpression(t.identifier('__p'), t.numericLiteral(i), true),
            ),
          ),
        ),
      );
    }
    body.push(
      ...kept,
      updateDecl(scope.updaters),
      registerStmt(t.identifier('id'), t.identifier('parent')),
    );
    if (propNames.length > 0) {
      body.push(
        t.expressionStatement(
          t.callExpression(md('registerProps'), [t.identifier('id'), t.identifier('__p')]),
        ),
      );
    }
    body.push(...scope.creation, t.returnStatement(t.identifier(rootVar)));

    node.params =
      propNames.length > 0
        ? [t.identifier('id'), t.identifier('parent'), t.identifier('__p')]
        : [t.identifier('id'), t.identifier('parent')];
    node.body = t.blockStatement(body);
}

// ---------------------------------------------------------------------
// JSX emission
// ---------------------------------------------------------------------

function freshSlot(scope: EmitScope): string {
  const key = `s${scope.slots.length}`;
  scope.slots.push(key);
  return key;
}

/**
 * JSX text normalization (React-compatible): whitespace runs collapse to a
 * single space, but an edge space is dropped only when it comes from a line
 * break. So "in {count}" keeps its trailing space while indentation-only
 * chunks vanish. (Naive trim() used to eat same-line edge spaces — M8 fix.)
 */
function jsxText(raw: string): string {
  let v = raw.replace(/\s+/g, ' ');
  if (/^\s*\n/.test(raw)) v = v.replace(/^ /, '');
  if (/\n\s*$/.test(raw)) v = v.replace(/ $/, '');
  return v;
}

function nodeVar(scope: EmitScope, tag: string): string {
  const n = scope.tagCounters.get(tag) ?? 0;
  scope.tagCounters.set(tag, n + 1);
  return `${tag}${n}`;
}

/** setText($, key, textNode, value) */
function textSetter(key: string, varName: string, expr: t.Expression): () => t.Statement {
  return () =>
    t.expressionStatement(
      t.callExpression(md('setText'), [
        t.identifier('$'),
        t.stringLiteral(key),
        t.identifier(varName),
        t.cloneNode(expr),
      ]),
    );
}

function emitText(scope: EmitScope, expr: t.Expression): string {
  const varName = `text${scope.textCounter++}`;
  if (t.isStringLiteral(expr)) {
    // static text: no slot, content baked into the node
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(varName),
          t.callExpression(
            t.memberExpression(t.identifier('document'), t.identifier('createTextNode')),
            [t.stringLiteral(expr.value)],
          ),
        ),
      ]),
    );
    return varName;
  }
  const key = freshSlot(scope);
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(varName),
        t.callExpression(
          t.memberExpression(t.identifier('document'), t.identifier('createTextNode')),
          [t.stringLiteral('')],
        ),
      ),
    ]),
  );
  const setter = textSetter(key, varName, expr);
  scope.creation.push(setter()); // R4: creation seeds through the same guarded setter
  scope.updaters.push(setter);
  return varName;
}

function emitElement(
  ctx: Ctx,
  scope: EmitScope,
  el: t.JSXElement,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null = null,
): string {
  const open = el.openingElement;
  const tag = (open.name as t.JSXIdentifier).name;

  // -- nested component: call its factory, append what it returns --------
  if (/^[A-Z]/.test(tag)) {
    // repeated children of the same type need distinct variables AND
    // distinct entity ids: 'App/Tag', 'App/Tag[1]', …
    const seen = scope.childCounts.get(tag) ?? 0;
    scope.childCounts.set(tag, seen + 1);
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    const varName = seen === 0 ? base : `${base}${seen}`;
    const idSuffix = seen === 0 ? `/${tag}` : `/${tag}[${seen}]`;
    const props: t.Expression[] = [];
    let needsPush = false;
    for (const attr of open.attributes) {
      const a = attr as t.JSXAttribute;
      const v = attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: prop '${(a.name as t.JSXIdentifier).name}' on <${tag}> must be an expression (L1)`,
        );
      }
      if (exprReadsState(ctx, v)) needsPush = true;
      props.push(t.cloneNode(v));
    }
    const childId = t.binaryExpression('+', t.identifier('id'), t.stringLiteral(idSuffix));
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(varName),
          t.callExpression(t.identifier(tag), [
            childId,
            t.identifier('id'),
            ...(props.length > 0 ? [t.arrayExpression(props)] : []),
          ]),
        ),
      ]),
    );
    // R10: re-push state-reading props inside the parent's update — the box
    // flows down through setProps (shallow-compare → no-op when unchanged)
    if (needsPush) {
      scope.updaters.push(() =>
        t.expressionStatement(
          t.callExpression(md('setProps'), [
            t.binaryExpression('+', t.identifier('id'), t.stringLiteral(idSuffix)),
            t.arrayExpression(props.map((p) => t.cloneNode(p))),
          ]),
        ),
      );
    }
    return varName;
  }

  // -- host element: children first (post-order creation) ----------------
  const childVars: string[] = [];
  const pendingLists: t.CallExpression[] = [];
  const pendingConds: Array<t.ConditionalExpression | t.LogicalExpression> = [];
  for (const child of el.children) {
    if (t.isJSXText(child)) {
      const value = jsxText(child.value);
      if (value === '') continue;
      childVars.push(emitText(scope, t.stringLiteral(value)));
    } else if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      if (!t.isExpression(child.expression)) {
        throw compPath.buildCodeFrameError(
          'memo-dom: unsupported expression in JSX child position (L1)',
        );
      }
      // static falsy children render nothing (M5.3: {null} used to print "null")
      const ex = child.expression;
      if (
        t.isNullLiteral(ex) ||
        t.isBooleanLiteral(ex) ||
        t.isIdentifier(ex, { name: 'undefined' })
      ) {
        continue;
      }
      const mapCall = matchMapCall(ex);
      if (mapCall) {
        pendingLists.push(mapCall); // regions own their nodes; no childVar
        continue;
      }
      const condExpr = matchCond(ex);
      if (condExpr !== null && nodeHasJsx(condExpr)) {
        pendingConds.push(condExpr); // conditional regions own their nodes
        continue;
      }
      childVars.push(emitText(scope, t.cloneNode(ex)));
    } else if (t.isJSXElement(child)) {
      childVars.push(emitElement(ctx, scope, child, compName, compPath, nestedIn));
    } else {
      throw compPath.buildCodeFrameError(
        'memo-dom: spread children are not supported (L1)',
      );
    }
  }

  const varName = nodeVar(scope, tag);
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(varName),
        t.callExpression(
          t.memberExpression(t.identifier('document'), t.identifier('createElement')),
          [t.stringLiteral(tag)],
        ),
      ),
    ]),
  );

  // -- attributes ---------------------------------------------------------
  for (const attr of open.attributes) {
    const a = attr as t.JSXAttribute;
    const attrName = (a.name as t.JSXIdentifier).name;

    // backstop: row-root keys are stripped before emission, so any key
    // reaching here is misuse (analysis catches static cases with a nicer
    // message; row/branch subtrees skip that pass)
    if (attrName === 'key') {
      throw compPath.buildCodeFrameError(
        'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
      );
    }

    if (/^on[A-Z]/.test(attrName)) {
      const v = attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: ${attrName} needs a handler expression (L1)`,
        );
      }
      const handler = buildHandler(ctx, compPath, v, attrName, compName);
      scope.creation.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier(varName), t.identifier(attrName.toLowerCase())),
            handler,
          ),
        ),
      );
      continue;
    }

    if (t.isStringLiteral(a.value)) {
      if (attrName === 'class') {
        scope.creation.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier(varName), t.identifier('className')),
              t.stringLiteral(a.value.value),
            ),
          ),
        );
      } else {
        scope.creation.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(varName), t.identifier('setAttribute')),
              [t.stringLiteral(attrName), t.stringLiteral(a.value.value)],
            ),
          ),
        );
      }
      continue;
    }

    const v = attrExpr(a.value);
    if (v == null || t.isStringLiteral(v)) {
      throw compPath.buildCodeFrameError(
        `memo-dom: attribute '${attrName}' needs a string or an expression (L1)`,
      );
    }
    const expr = t.cloneNode(v);
    const key = freshSlot(scope);
    const makeCall = (): t.Statement =>
      attrName === 'class'
        ? t.expressionStatement(
            t.callExpression(md('setClassName'), [
              t.identifier('$'),
              t.stringLiteral(key),
              t.identifier(varName),
              t.cloneNode(expr),
            ]),
          )
        : t.expressionStatement(
            t.callExpression(md('setAttr'), [
              t.identifier('$'),
              t.stringLiteral(key),
              t.identifier(varName),
              t.stringLiteral(attrName),
              t.cloneNode(expr),
            ]),
          );
    scope.creation.push(makeCall());
    scope.updaters.push(makeCall);
  }

  // -- append children ------------------------------------------------------
  for (const cv of childVars) {
    scope.creation.push(
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier(varName), t.identifier('appendChild')),
          [t.identifier(cv)],
        ),
      ),
    );
  }

  // -- regions (the parent element exists by now) ---------------------------
  if (pendingLists.length > 0 && nestedIn !== null) {
    throw compPath.buildCodeFrameError(
      `memo-dom: nested lists inside ${nestedIn === 'row' ? 'list rows' : 'conditional branches'} are not supported yet (L1)`,
    );
  }
  if (pendingConds.length > 0 && nestedIn !== null) {
    throw compPath.buildCodeFrameError(
      `memo-dom: conditionals inside ${nestedIn === 'row' ? 'list rows' : 'conditional branches'} are not supported yet (R8 L1)`,
    );
  }
  for (const call of pendingLists) {
    emitRegion(ctx, scope, call, varName, compName, compPath);
  }
  for (const expr of pendingConds) {
    emitCondRegion(ctx, scope, expr, varName, compName, compPath);
  }

  return varName;
}

// ---------------------------------------------------------------------
// R7: list regions
// ---------------------------------------------------------------------

function emitRegion(
  ctx: Ctx,
  scope: EmitScope,
  call: t.CallExpression,
  parentElVar: string,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
): void {
  const site = analyzeMapSite(ctx, call, compPath, compName, scope.usedPrefixes);

  const regionVar = `region${scope.regionCounter++}`;
  const createFn =
    site.form === 'component'
      ? buildComponentRowCreate(site)
      : buildInlineRowCreate(ctx, site, compName, compPath);

  const args: t.Expression[] = [
    t.identifier(parentElVar),
    t.binaryExpression('+', t.identifier('id'), t.stringLiteral(`/${site.suffix}`)),
    createFn,
  ];
  if (site.keyExpr !== null) {
    args.push(
      t.arrowFunctionExpression([t.identifier(site.itemParam)], t.cloneNode(site.keyExpr)),
    );
  }
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(regionVar),
        t.callExpression(md('createListRegion'), args),
      ),
    ]),
  );

  // initial population + every owner render re-reconciles (region diffs)
  scope.creation.push(
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier(regionVar), t.identifier('reconcile')),
        [t.cloneNode(site.arrayExpr)],
      ),
    ),
  );
  scope.updaters.push(() =>
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier(regionVar), t.identifier('reconcile')),
        [t.cloneNode(site.arrayExpr)],
      ),
    ),
  );
}

/** (item, rowId) => { nodes: [el], entities: [rowId] } via the row factory. */
function buildComponentRowCreate(site: MapSite): t.ArrowFunctionExpression {
  const props: t.Expression[] = [];
  for (const attr of site.jsx.openingElement.attributes) {
    const a = attr as t.JSXAttribute;
    const name = (a.name as t.JSXIdentifier).name;
    if (name === 'key') continue;
    props.push(t.cloneNode(attrExpr(a.value)!));
  }
  const el = t.identifier('el');
  const entry: t.ObjectProperty[] = [
    t.objectProperty(t.identifier('nodes'), t.arrayExpression([el])),
    t.objectProperty(t.identifier('entities'), t.arrayExpression([t.identifier('rowId')])),
  ];
  // R10: retained rows get their props box re-pushed on every reconcile —
  // item replacement AND item-field mutation both reach the row entity.
  // The row is ALWAYS dirtied (not just on identity change): the box can
  // hold the same object whose FIELDS mutated invisibly — the M5.5 case.
  if (props.length > 0) {
    entry.push(
      t.objectProperty(
        t.identifier('updateProps'),
        t.arrowFunctionExpression(
          [t.identifier(site.itemParam)],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(md('setProps'), [
                t.identifier('rowId'),
                t.arrayExpression(props.map((p) => t.cloneNode(p))),
              ]),
            ),
            t.expressionStatement(
              t.callExpression(md('markDirty'), [t.identifier('rowId')]),
            ),
          ]),
        ),
      ),
    );
  }
  return t.arrowFunctionExpression(
    [t.identifier(site.itemParam), t.identifier('rowId')],
    t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          el,
          t.callExpression(t.identifier(site.rowComp!), [
            t.identifier('rowId'),
            t.identifier('id'), // owner's id — closure over the factory scope
            ...(props.length > 0 ? [t.arrayExpression(props)] : []),
          ]),
        ),
      ]),
      t.returnStatement(t.objectExpression(entry)),
    ]),
  );
}


/**
 * An inline row is a small entity factory of its own, nested in the owner:
 * own slot cache, own update closure, register(parent = owner id), and a
 * ListEntry return. Emitted into a fresh EmitScope so its variables and
 * slots never collide with the owner's.
 */
function buildInlineRowCreate(
  ctx: Ctx,
  site: MapSite,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
): t.ArrowFunctionExpression {
  // 'key' is region metadata, not a DOM attribute — strip before emission
  site.jsx.openingElement.attributes = site.jsx.openingElement.attributes.filter(
    (a) =>
      t.isJSXSpreadAttribute(a) ||
      (a.name as t.JSXIdentifier).name !== 'key',
  );
  const rowScope = newScope();
  const rootVar = emitElement(ctx, rowScope, site.jsx, compName, compPath, 'row');
  return t.arrowFunctionExpression(
    [t.identifier(site.itemParam), t.identifier('rowId')],
    t.blockStatement([
      cacheDecl(rowScope.slots),
      updateDecl(rowScope.updaters),
      registerStmt(t.identifier('rowId'), t.identifier('id')),
      ...rowScope.creation,
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(t.identifier('nodes'), t.arrayExpression([t.identifier(rootVar)])),
          t.objectProperty(t.identifier('entities'), t.arrayExpression([t.identifier('rowId')])),
          // M5.5: reconcile re-runs this on reused rows so externally
          // mutated item data (row reads params, not state) re-syncs
          t.objectProperty(t.identifier('update'), t.identifier('update')),
        ]),
      ),
    ]),
  );
}

// ---------------------------------------------------------------------
// R8: conditional regions
// ---------------------------------------------------------------------

/**
 * `{cond ? <A/> : <B/>}` → an anchored conditional region, registered as its
 * OWN entity ('<ownerId>/when<n>') so the table routes the region's vars to
 * it. The render closure is `() => whenN.update()` — a closure over the
 * region variable declared right after (same pattern as the component's own
 * update closure; render only runs post-mount).
 */
function emitCondRegion(
  ctx: Ctx,
  scope: EmitScope,
  expr: t.ConditionalExpression | t.LogicalExpression,
  parentElVar: string,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
): void {
  const site = analyzeCondSite(expr, compPath, scope.usedConds);
  const regionVar = site.suffix; // 'when0', 'when1', … — valid JS identifiers

  const pick = t.arrowFunctionExpression([], t.cloneNode(site.pickExpr));
  const branchFns: t.Expression[] = [site.thenJsx, site.elseJsx].map((jsx) =>
    jsx !== null ? buildBranchCreate(ctx, jsx, compName, compPath) : t.nullLiteral(),
  );

  // register BEFORE creation (parent-first invariant; branch factories run
  // during createCondRegion's initial update)
  scope.creation.push(
    registerStmt(
      t.binaryExpression('+', t.identifier('id'), t.stringLiteral(`/${site.suffix}`)),
      t.identifier('id'),
      t.arrowFunctionExpression(
        [],
        t.callExpression(
          t.memberExpression(t.identifier(regionVar), t.identifier('update')),
          [],
        ),
      ),
    ),
  );
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(regionVar),
        t.callExpression(md('createCondRegion'), [
          t.identifier(parentElVar),
          t.binaryExpression('+', t.identifier('id'), t.stringLiteral(`/${site.suffix}`)),
          pick,
          t.arrayExpression(branchFns),
        ]),
      ),
    ]),
  );
  // NOTE: the owner's update does NOT call whenN.update() — the region is
  // dirtied through the access table (its reads are attributed to it).
}

/**
 * A branch is a small factory: own slot cache, own guarded update closure,
 * NO register (branches are not entities — a swap just removes their nodes).
 * Emitted into a fresh EmitScope so variables and slots never collide.
 */
function buildBranchCreate(
  ctx: Ctx,
  jsx: t.JSXElement,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
): t.ArrowFunctionExpression {
  const branchScope = newScope();
  const rootVar = emitElement(ctx, branchScope, jsx, compName, compPath, 'cond');
  return t.arrowFunctionExpression(
    [],
    t.blockStatement([
      cacheDecl(branchScope.slots),
      updateDecl(branchScope.updaters),
      ...branchScope.creation,
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(t.identifier('nodes'), t.arrayExpression([t.identifier(rootVar)])),
          t.objectProperty(t.identifier('update'), t.identifier('update')),
        ]),
      ),
    ]),
  );
}

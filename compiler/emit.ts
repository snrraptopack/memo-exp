/**
 * emit.ts — R1–R4 + R7 emission: component functions → entity factories.
 *
 *   R1  factory shape: (id, parent, …props), register before creation
 *   R2  JSX → creation branch with cached node variables (post-order)
 *   R3  dynamic expressions → numbered slots with guarded setters
 *   R4  creation runs the same guarded setters (null cache → first write)
 *   R7  {items.map(item => …)} → createListRegion + row factories
 *
 * Emission state is explicit (EmitScope) rather than closure-local so that
 * inline list rows can emit into a NESTED scope: an inline row is a small
 * entity factory of its own (own slots, own update, register parent=id),
 * created per item by the region.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  attrExpr,
  exprReadsState,
  keyPathOf,
  nodeHasJsx,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
  generatedIdentifier,
  md,
  requireIdentifiers,
} from './identifiers';
import {
  cacheDecl,
  freshNodeName,
  freshSlot,
  newEmitScope,
  registerStmt,
  slotGuard,
  updateDecl,
  type EmitScope,
} from './emission-scope';
import { analyzeMapSite, matchMapCall, type MapSite } from './lists';
import { analyzeCondSite, matchCond } from './conds';
import { buildHandler } from './handlers';
import { isLightweightListedComponent } from './analysis';

// ---------------------------------------------------------------------
// shared statement builders
// ---------------------------------------------------------------------

/**
 * M5.9: dynamic slots are per-scope LOCALS (`let $s0, $s1, …`), not a cache
 * object with string keys — the update closure guards inline
 * (`if ($s0 !== ($t = expr)) { $s0 = $t; …write… }`), which keeps the whole
 * row update in one inlinable function instead of N calls × string lookups.
 */
/**
 * The inline guarded write shared by every dynamic slot:
 * `if ($sK !== ($t = EXPR)) { $sK = $t; WRITE($t) }` — used for BOTH the
 * creation and the update branch: a fresh slot (undefined) never equals a
 * legit first value except undefined/null/boolean, and for those the
 * freshly-created DOM node already holds exactly what the write would set
 * (empty text data, empty className, absent attribute).
 */
/** The value-normalization shared by text semantics: null/undefined/bool → ''. */
function textValue(tmp: t.Identifier): t.Expression {
  return t.conditionalExpression(
    t.logicalExpression(
      '||',
      t.binaryExpression('==', t.cloneNode(tmp), t.nullLiteral()),
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', t.cloneNode(tmp), true),
        t.stringLiteral('boolean'),
      ),
    ),
    t.stringLiteral(''),
    t.callExpression(t.identifier('String'), [t.cloneNode(tmp)]),
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

  // -- R10: prop names (needed early: R11 row context uses the first one)
  const propNames: string[] = [];
  for (const p of node.params) {
    if (!t.isIdentifier(p)) {
      throw path.buildCodeFrameError(
        `memo-dom: component '${name}' props must be plain identifier params (R10 L1) — destructure inside the body if needed`,
      );
    }
    propNames.push(p.name);
  }

  const lightweight = isLightweightListedComponent(ctx, name);
  const scope = newEmitScope(ctx);
  const factoryId = generatedIdentifier(ctx, 'id').name;
  const factoryParent = lightweight ? null : generatedIdentifier(ctx, 'parent').name;
  const propsBox =
    propNames.length > 0 && !lightweight
      ? generatedIdentifier(ctx, 'props').name
      : null;
  requireIdentifiers(ctx).registerComponentId(name, factoryId);

  // -- R11: a listed (multi-instance) component is a list row — handlers
  // writing its item prop's fields commit locally (markDirty(id)).
  let rowCtx: RowCtx | undefined;
  const refs = ctx.listedSites.get(name);
  if (refs !== undefined && refs.length > 0 && propNames.length > 0) {
    const keyPaths = refs.map((r) => keyPathOf(r.keyExpr ?? null, r.itemParam ?? ''));
    const first = JSON.stringify(keyPaths[0]);
    const merged = keyPaths.every((k) => JSON.stringify(k) === first)
      ? keyPaths[0]!
      : null; // disagreeing key fns → unknown → all item writes fall back
    rowCtx = {
      itemParam: propNames[0]!,
      rowIdVar: factoryId,
      ...(lightweight ? { refreshVar: scope.updateVar } : {}),
      keyPath: merged,
      arrayName: refs[0]!.arrayName ?? '',
    };
  }

  // -- emit --------------------------------------------------------------
  const rootVar = emitElement(ctx, scope, jsx, name, path, null, rowCtx);

  // R14: local derivations live in the instance closure and recompute at the
  // front of update(). Props re-sync is unshifted below, so final order is:
  // props -> derivations (source order) -> child/DOM guarded writes.
  const localComputeds = ctx.instanceComputeds.get(name);
  if (localComputeds !== undefined) {
    for (const stmt of node.body.body) {
      if (
        t.isVariableDeclaration(stmt, { kind: 'const' }) &&
        stmt.declarations.some((d) => t.isIdentifier(d.id) && localComputeds.has(d.id.name))
      ) {
        (stmt as t.VariableDeclaration).kind = 'let';
      }
    }
    scope.updaters.unshift(() =>
      t.blockStatement(
        [...localComputeds].map(([computedName, expr]) =>
          t.expressionStatement(
            t.assignmentExpression('=', t.identifier(computedName), t.cloneNode(expr)),
          ),
        ),
      ),
    );
  }

  const kept = node.body.body.filter((s) => s !== returnStmt);

  // -- R10: props box. User params become locals synced from __p ---------
  if (propNames.length > 0 && !lightweight) {
    // re-sync locals from the box at the top of every update
    scope.updaters.unshift(() =>
      t.blockStatement(
        propNames.map((pn, i) =>
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.identifier(pn),
              t.memberExpression(t.identifier(propsBox!), t.numericLiteral(i), true),
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
  const body: t.Statement[] = [cacheDecl(scope)];
  if (propNames.length > 0 && !lightweight) {
    body.push(
      t.variableDeclaration(
        'let',
        propNames.map((pn, i) =>
          t.variableDeclarator(
            t.identifier(pn),
            t.memberExpression(t.identifier(propsBox!), t.numericLiteral(i), true),
          ),
        ),
      ),
    );
  }
  body.push(
    ...kept,
    updateDecl(scope),
    ...(lightweight
      ? []
      : [
          registerStmt(
            ctx,
            t.identifier(factoryId),
            t.identifier(factoryParent!),
            t.identifier(scope.updateVar),
          ),
        ]),
  );
  if (propNames.length > 0 && !lightweight) {
    body.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'registerProps'), [
          t.identifier(factoryId),
          t.identifier(propsBox!),
        ]),
      ),
    );
  }
  body.push(...scope.creation);
  if (lightweight) {
    const nextProps = propNames.map((_, i) =>
      generatedIdentifier(ctx, `nextProp${i}`),
    );
    body.push(
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(t.identifier('nodes'), t.arrayExpression([t.identifier(rootVar)])),
          t.objectProperty(t.identifier('entities'), t.arrayExpression([])),
          t.objectProperty(t.identifier('update'), t.identifier(scope.updateVar)),
          ...(propNames.length > 0
            ? [
                t.objectProperty(
                  t.identifier('updateProps'),
                  t.arrowFunctionExpression(
                    nextProps,
                    t.blockStatement(
                      propNames.map((pn, i) =>
                        t.expressionStatement(
                          t.assignmentExpression('=', t.identifier(pn), nextProps[i]!),
                        ),
                      ),
                    ),
                  ),
                ),
              ]
            : []),
        ]),
      ),
    );
  } else {
    body.push(t.returnStatement(t.identifier(rootVar)));
  }

  node.params =
    lightweight
      ? [...propNames.map((pn) => t.identifier(pn)), t.identifier(factoryId)]
      : propNames.length > 0
      ? [
          t.identifier(factoryId),
          t.identifier(factoryParent!),
          t.identifier(propsBox!),
        ]
      : [t.identifier(factoryId), t.identifier(factoryParent!)];
  node.body = t.blockStatement(body);
}

// ---------------------------------------------------------------------
// JSX emission
// ---------------------------------------------------------------------

/**
 * M5.8: attributes that are really DOM IDL properties — written via
 * setProp (el.x = v) instead of setAttribute. Conservative set: boolean
 * and value-bearing properties where the attribute form is only a
 * DEFAULT (checked, value, …), never reflective state we should stomp.
 */
const DOM_PROP_ATTRS = new Set([
  'checked',
  'value',
  'selected',
  'disabled',
  'hidden',
  'multiple',
  'required',
  'readonly',
  'muted',
  'open',
  'controls',
  'loop',
  'autofocus',
  'autoplay',
]);

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

/** M5.9: inline text write — if ($sK !== ($t = expr)) { $sK = $t; node.data = … } */
function textSetter(
  scope: EmitScope,
  key: string,
  varName: string,
  expr: t.Expression,
): () => t.Statement {
  return () =>
    slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier(varName), t.identifier('data')),
          textValue(tmp),
        ),
      ),
    );
}

function emitText(ctx: Ctx, scope: EmitScope, expr: t.Expression): string {
  const varName = generatedIdentifier(ctx, `text${scope.textCounter++}`).name;
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
  const key = freshSlot(ctx, scope);
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
  const setter = textSetter(scope, key, varName, expr);
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
  rowCtx?: RowCtx,
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
    const candidate = seen === 0 ? base : `${base}${seen}`;
    // A generated child result must never shadow a user/module binding. The
    // old `const count = Count(..., [count])` both hit the TDZ in its own
    // initializer and changed every later `count` reference in the factory.
    const varName = generatedIdentifier(ctx, candidate).name;
    const idSuffix = seen === 0 ? `/${tag}` : `/${tag}[${seen}]`;
    const propEntries: Array<{ name: string; value: t.Expression }> = [];
    let needsPush = false;
    for (const attr of open.attributes) {
      const a = attr as t.JSXAttribute;
      const v = attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: prop '${(a.name as t.JSXIdentifier).name}' on <${tag}> must be an expression (L1)`,
        );
      }
      // R12: instance-state reads also need re-push (parent re-renders on
      // instance writes → this updater re-syncs the child's props box)
      if (exprReadsState(ctx, v, compName)) needsPush = true;
      propEntries.push({ name: (a.name as t.JSXIdentifier).name, value: t.cloneNode(v) });
    }
    // Props are matched BY NAME against the callee's declared params — JSX
    // attribute order is irrelevant (positional matching silently misaligned
    // props when attribute order and declaration order disagreed).
    const props = orderCallProps(ctx, tag, propEntries);
    const childId = t.binaryExpression(
      '+',
      componentId(ctx, compName),
      t.stringLiteral(idSuffix),
    );
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(varName),
          t.callExpression(t.identifier(tag), [
            childId,
            componentId(ctx, compName),
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
          t.callExpression(md(ctx, 'setProps'), [
            t.binaryExpression('+', componentId(ctx, compName), t.stringLiteral(idSuffix)),
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
      childVars.push(emitText(ctx, scope, t.stringLiteral(value)));
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
      childVars.push(emitText(ctx, scope, t.cloneNode(ex)));
    } else if (t.isJSXElement(child)) {
      childVars.push(emitElement(ctx, scope, child, compName, compPath, nestedIn, rowCtx));
    } else {
      throw compPath.buildCodeFrameError(
        'memo-dom: spread children are not supported (L1)',
      );
    }
  }

  const varName = freshNodeName(ctx, scope, tag);
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
      const handler = buildHandler(ctx, compPath, v, attrName, compName, rowCtx);
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
    const key = freshSlot(ctx, scope);
    // M5.8: IDL-property attributes (checked, value, disabled, …) write the
    // DOM property, not the attribute — faster (no attribute-tree walk) and
    // semantically correct for state that lives on the element object.
    const propName = DOM_PROP_ATTRS.has(attrName) ? attrName : null;
    // M5.9: inline guarded writes (see slotGuard) — no MD.setX call overhead
    const makeCall = (): t.Statement =>
      attrName === 'class'
        ? slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.identifier(varName), t.identifier('className')),
                tmp,
              ),
            ),
          )
        : propName !== null
          ? slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.memberExpression(t.identifier(varName), t.identifier(propName)),
                  tmp,
                ),
              ),
            )
          : slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
              t.expressionStatement(
                t.conditionalExpression(
                  t.logicalExpression(
                    '||',
                    t.binaryExpression('==', t.cloneNode(tmp), t.nullLiteral()),
                    t.binaryExpression('===', t.cloneNode(tmp), t.booleanLiteral(false)),
                  ),
                  t.callExpression(
                    t.memberExpression(t.identifier(varName), t.identifier('removeAttribute')),
                    [t.stringLiteral(attrName)],
                  ),
                  t.callExpression(
                    t.memberExpression(t.identifier(varName), t.identifier('setAttribute')),
                    [
                      t.stringLiteral(attrName),
                      t.conditionalExpression(
                        t.binaryExpression('===', t.cloneNode(tmp), t.booleanLiteral(true)),
                        t.stringLiteral(''),
                        t.callExpression(t.identifier('String'), [t.cloneNode(tmp)]),
                      ),
                    ],
                  ),
                ),
              ),
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

  const regionVar = generatedIdentifier(
    ctx,
    `region${scope.regionCounter++}`,
  ).name;
  const createFn =
    site.form === 'component'
      ? buildComponentRowCreate(ctx, site)
      : buildInlineRowCreate(ctx, site, compName, compPath);

  const args: t.Expression[] = [
    t.identifier(parentElVar),
    t.binaryExpression('+', componentId(ctx, compName), t.stringLiteral(`/${site.suffix}`)),
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
        t.callExpression(md(ctx, 'createListRegion'), args),
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

/**
 * Order a call site's props to match the callee's DECLARED param order,
 * matched by attribute name — never by JSX attribute position. Object-prop
 * components (`Row(props: {...})`) receive one object literal instead.
 * Unknown attribute names are a compile error (catches typos and events on
 * component tags, which L1 has no design for); undeclared-but-missing props
 * pass `undefined`, matching plain JS call semantics.
 */
function orderCallProps(
  ctx: Ctx,
  tag: string,
  entries: Array<{ name: string; value: t.Expression }>,
): t.Expression[] {
  if (ctx.objectPropComponents.has(tag)) {
    return [
      t.objectExpression(
        entries.map((e) =>
          t.objectProperty(
            t.identifier(e.name),
            e.value,
            false,
            t.isIdentifier(e.value) && e.value.name === e.name,
          ),
        ),
      ),
    ];
  }
  const declared = ctx.compPropNames.get(tag);
  if (declared === undefined) return entries.map((e) => e.value);
  const byName = new Map(entries.map((e) => [e.name, e.value]));
  for (const name of byName.keys()) {
    if (!declared.includes(name)) {
      throw new Error(
        `memo-dom: unknown prop '${name}' on <${tag}> — declared props: ${
          declared.length > 0 ? declared.join(', ') : '(none)'
        }`,
      );
    }
  }
  return declared.map((pn) => byName.get(pn) ?? t.identifier('undefined'));
}

function buildComponentRowCreate(ctx: Ctx, site: MapSite): t.ArrowFunctionExpression {
  const propEntries: Array<{ name: string; value: t.Expression }> = [];
  for (const attr of site.jsx.openingElement.attributes) {
    const a = attr as t.JSXAttribute;
    const name = (a.name as t.JSXIdentifier).name;
    if (name === 'key') continue;
    propEntries.push({ name, value: t.cloneNode(attrExpr(a.value)!) });
  }
  const callProps = orderCallProps(ctx, site.rowComp!, propEntries);
  const rowId = generatedIdentifier(ctx, 'rowId');
  if (isLightweightListedComponent(ctx, site.rowComp!)) {
    const entry = generatedIdentifier(ctx, 'entry');
    return t.arrowFunctionExpression(
      [t.identifier(site.itemParam), t.cloneNode(rowId)],
      t.blockStatement([
        t.variableDeclaration('const', [
          t.variableDeclarator(
            entry,
            t.callExpression(t.identifier(site.rowComp!), [
              ...callProps.map((p) => t.cloneNode(p)),
              t.cloneNode(rowId),
            ]),
          ),
        ]),
        t.returnStatement(
          t.objectExpression([
            t.objectProperty(
              t.identifier('nodes'),
              t.memberExpression(entry, t.identifier('nodes')),
            ),
            t.objectProperty(t.identifier('entities'), t.arrayExpression([])),
            t.objectProperty(
              t.identifier('update'),
              t.memberExpression(entry, t.identifier('update')),
            ),
            ...(callProps.length > 0
              ? [
                  t.objectProperty(
                    t.identifier('updateProps'),
                    t.arrowFunctionExpression(
                      [t.identifier(site.itemParam)],
                      t.blockStatement([
                        t.expressionStatement(
                          t.callExpression(
                            t.memberExpression(entry, t.identifier('updateProps')),
                            callProps.map((p) => t.cloneNode(p)),
                          ),
                        ),
                      ]),
                    ),
                  ),
                ]
              : []),
          ]),
        ),
      ]),
    );
  }
  const el = generatedIdentifier(ctx, 'rowElement');
  const entry: t.ObjectProperty[] = [
    t.objectProperty(t.identifier('nodes'), t.arrayExpression([el])),
    t.objectProperty(t.identifier('entities'), t.arrayExpression([t.cloneNode(rowId)])),
  ];
  // R10: retained rows get their props box re-pushed on every reconcile —
  // item replacement AND item-field mutation both reach the row entity.
  // The row is ALWAYS dirtied (not just on identity change): the box can
  // hold the same object whose FIELDS mutated invisibly — the M5.5 case.
  if (callProps.length > 0) {
    entry.push(
      t.objectProperty(
        t.identifier('updateProps'),
        t.arrowFunctionExpression(
          [t.identifier(site.itemParam)],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(md(ctx, 'setProps'), [
                t.cloneNode(rowId),
                t.arrayExpression(callProps.map((p) => t.cloneNode(p))),
              ]),
            ),
            t.expressionStatement(
              t.callExpression(md(ctx, 'markDirty'), [t.cloneNode(rowId)]),
            ),
          ]),
        ),
      ),
    );
  }
  return t.arrowFunctionExpression(
    [t.identifier(site.itemParam), t.cloneNode(rowId)],
    t.blockStatement([
      t.variableDeclaration('const', [
        t.variableDeclarator(
          el,
          t.callExpression(t.identifier(site.rowComp!), [
            t.cloneNode(rowId),
            componentId(ctx, site.owner), // owner's id — closure over the factory scope
            ...(callProps.length > 0 ? [t.arrayExpression(callProps)] : []),
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
  const rowScope = newEmitScope(ctx);
  const rowId = generatedIdentifier(ctx, 'rowId').name;
  // R11: handlers inside the row may write the item's fields — those
  // commits stay row-local (markDirty(rowId)); key-field writes fall back
  // to a source-array write handled inside handler analysis.
  const rowCtx: RowCtx = {
    itemParam: site.itemParam,
    rowIdVar: rowId,
    keyPath: keyPathOf(site.keyExpr, site.itemParam),
    arrayName: site.arrayName,
  };
  const rootVar = emitElement(ctx, rowScope, site.jsx, compName, compPath, 'row', rowCtx);
  return t.arrowFunctionExpression(
    [t.identifier(site.itemParam), t.identifier(rowId)],
    t.blockStatement([
      cacheDecl(rowScope),
      updateDecl(rowScope),
      registerStmt(
        ctx,
        t.identifier(rowId),
        componentId(ctx, compName),
        t.identifier(rowScope.updateVar),
      ),
      ...rowScope.creation,
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(t.identifier('nodes'), t.arrayExpression([t.identifier(rootVar)])),
          t.objectProperty(t.identifier('entities'), t.arrayExpression([t.identifier(rowId)])),
          // M5.5: reconcile re-runs this on reused rows so externally
          // mutated item data (row reads params, not state) re-syncs
          t.objectProperty(t.identifier('update'), t.identifier(rowScope.updateVar)),
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
  const regionVar = generatedIdentifier(ctx, site.suffix).name;

  const pick = t.arrowFunctionExpression([], t.cloneNode(site.pickExpr));
  const branchFns: t.Expression[] = [site.thenJsx, site.elseJsx].map((jsx) =>
    jsx !== null ? buildBranchCreate(ctx, jsx, compName, compPath) : t.nullLiteral(),
  );

  // register BEFORE creation (parent-first invariant; branch factories run
  // during createCondRegion's initial update)
  scope.creation.push(
    registerStmt(
      ctx,
      t.binaryExpression('+', componentId(ctx, compName), t.stringLiteral(`/${site.suffix}`)),
      componentId(ctx, compName),
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
        t.callExpression(md(ctx, 'createCondRegion'), [
          t.identifier(parentElVar),
          t.binaryExpression(
            '+',
            componentId(ctx, compName),
            t.stringLiteral(`/${site.suffix}`),
          ),
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
  const branchScope = newEmitScope(ctx);
  const rootVar = emitElement(ctx, branchScope, jsx, compName, compPath, 'cond');
  return t.arrowFunctionExpression(
    [],
    t.blockStatement([
      cacheDecl(branchScope),
      updateDecl(branchScope),
      ...branchScope.creation,
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(t.identifier('nodes'), t.arrayExpression([t.identifier(rootVar)])),
          t.objectProperty(t.identifier('update'), t.identifier(branchScope.updateVar)),
        ]),
      ),
    ]),
  );
}

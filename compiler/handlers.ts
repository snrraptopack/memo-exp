/**
 * handlers.ts — R5: event-handler write analysis and commit emission.
 *
 * Writes are grouped by their INNERMOST enclosing function scope, and each
 * scope gets its own commit appended to its own body (M5.1):
 *   - handler body            → commit at the end; async handlers commit in
 *                               the continuation, after every `await`
 *   - fire-and-forget nested callback (setTimeout / .then / subscription)
 *                             → commit at the end of THAT callback
 *
 * M5.3: commits are inserted before EVERY return of the writing scope
 * (early returns used to skip them); mutator calls are member-chain aware
 * (store.items.push → write 'store.items'); calls to module-level helpers
 * fold the callee's read/write summary into the calling scope.
 *
 * Commit form per scope:
 *   opaque (dynamic store path / store mutator) → markDirtySubtree(rootId)
 *   all writes read only by THIS component AND it is single-instance
 *                                             → markDirty(id)
 *   otherwise                                 → commitWrites(WRITES_n)
 *
 * Multi-instance (listed) components are never locality-eligible: one row
 * writing `selected` must dirty every row, so it routes through the table.
 * Module-level functions used as handlers have no `id` — always the table.
 */

import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import {
  freshWriteConst,
  md,
  memberKey,
  memberRootName,
  MUTATOR_METHODS,
  type Ctx,
} from './context';
import { summarizeHelper } from './analysis';

// @babel/traverse is CJS; under ESM the function lands on `.default`.
const traverse: typeof _traverse = (_traverse as any).default ?? (_traverse as any);

/**
 * Resolve a JSX handler attribute to an analyzable function, augmenting
 * named `const` handlers in place. Returns the expression to assign.
 */
export function buildHandler(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  value: t.Expression,
  attrName: string,
  compName: string,
): t.Expression {
  let target:
    | t.ArrowFunctionExpression
    | t.FunctionExpression
    | t.FunctionDeclaration
    | null = null;
  // module-level functions have no `id` in scope: their commits always route
  // through the table, never markDirty(id)
  let forceTable = false;

  if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
    target = value;
  } else if (t.isIdentifier(value)) {
    const binding = compPath.scope.getBinding(value.name);
    const decl = binding?.path;
    if (decl && decl.isVariableDeclarator()) {
      const init = decl.node.init;
      if (init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))) {
        target = init;
      }
    } else if (decl && decl.isFunctionDeclaration() && ctx.helpers.has(value.name)) {
      target = decl.node; // module-level function used directly as a handler
      forceTable = true;
    }
    if (!target) {
      throw compPath.buildCodeFrameError(
        `memo-dom: cannot resolve handler '${value.name}' — use an inline arrow, a component-local const, or a module-level function (L1)`,
      );
    }
  } else {
    throw compPath.buildCodeFrameError(
      `memo-dom: unsupported ${attrName} handler form — expected an arrow function or a function reference (L1)`,
    );
  }

  // normalize an implicit-return root body to a block so commits can append
  if (!t.isBlockStatement(target.body)) {
    target.body = t.blockStatement([
      t.expressionStatement(target.body as t.Expression),
    ]);
  }

  // a shared declaration (used by several attributes) is analyzed once
  if (!ctx.analyzedFunctions.has(target)) {
    ctx.analyzedFunctions.add(target);
    analyzeHandler(ctx, target, forceTable ? null : compName);
  }
  return t.isIdentifier(value) ? value : (target as t.Expression);
}

/** Vars a write-set routes to: components ∪ a pseudo-reader for list rows. */
function readersOfVar(ctx: Ctx, v: string): Set<string> {
  const out = new Set<string>();
  for (const [comp, vars] of ctx.compReads) {
    if (vars.has(v)) out.add(comp);
  }
  for (const site of ctx.rowReads.values()) {
    if (site.vars.has(v)) out.add('__rows__'); // multi-instance by construction
  }

  for (const site of ctx.condReads.values()) {
    if (site.vars.has(v)) out.add('__regions__'); // region-updated, not owner-updated
  }

  return out;
}

function analyzeHandler(
  ctx: Ctx,
  rootFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  compName: string | null,
): void {
  // Standalone traversal requires a Program/File root, so analysis runs on
  // a deep clone; commits are appended into the clone's scopes and the
  // mutated body is adopted wholesale at the end. (A FunctionDeclaration is
  // already a statement; expressions need an ExpressionStatement wrapper.)
  const clonedFn = t.cloneNode(rootFn);
  const ROOT: t.Node = clonedFn;
  const wrapper = t.file(
    t.program([
      t.isFunctionDeclaration(clonedFn)
        ? clonedFn
        : t.expressionStatement(clonedFn as t.Expression),
    ]),
  );

  const locals = new Set<string>();
  for (const param of clonedFn.params) {
    if (t.isIdentifier(param)) locals.add(param.name);
  }

  // pass A: locals declared anywhere inside the handler
  traverse(wrapper, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id)) locals.add(p.node.id.name);
    },
    Function(p) {
      for (const param of p.node.params) {
        if (t.isIdentifier(param)) locals.add(param.name);
      }
    },
  });

  // pass B: writes grouped by innermost enclosing function scope
  interface ScopeWrites {
    writes: Set<string>;
    rootFallback: boolean;
  }
  const scopes = new Map<t.Node, ScopeWrites>();
  const scopeOf = (p: NodePath): ScopeWrites => {
    const fn = p.getFunctionParent()?.node ?? ROOT;
    let s = scopes.get(fn);
    if (!s) scopes.set(fn, (s = { writes: new Set(), rootFallback: false }));
    return s;
  };

  const noteMemberWrite = (p: NodePath, node: t.MemberExpression): void => {
    const rootName = memberRootName(node);
    if (!rootName || !ctx.state.has(rootName)) return; // foreign objects: not tracked
    const kind = ctx.state.get(rootName)!;
    const s = scopeOf(p);
    if (kind !== 'store') {
      // reads of root-keyed vars (let/const): any member write is a write
      // to the variable (items[0] = x, items.length = 0, …)
      s.writes.add(rootName);
      return;
    }
    const key = memberKey(node);
    if (key !== null && key.includes('.')) {
      s.writes.add(key);
    } else {
      // dynamic path (store[k] = …) or bare store write — opaque
      ctx.opaqueVars.add(rootName);
      s.rootFallback = true;
    }
  };

  traverse(wrapper, {
    AssignmentExpression(p) {
      const left = p.node.left;
      if (t.isIdentifier(left)) {
        if (locals.has(left.name)) return;
        const kind = ctx.state.get(left.name);
        if (!kind) {
          throw p.buildCodeFrameError(
            `memo-dom: handler assigns '${left.name}', which is neither module state nor a handler local — declare it at module level (let) or inside the handler`,
          );
        }
        if (kind === 'store') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign store '${left.name}' — assign a property (${left.name}.field = …) instead`,
          );
        }

        if (kind === 'const') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign const collection '${left.name}' — mutate its contents (${left.name}.push(…) / .set(…)) instead`,
          );
        }

        scopeOf(p).writes.add(left.name);
      } else if (t.isMemberExpression(left)) {
        noteMemberWrite(p, left);
      }
    },
    UpdateExpression(p) {
      const arg = p.node.argument;
      if (t.isIdentifier(arg)) {
        if (locals.has(arg.name)) return;
        const kind = ctx.state.get(arg.name)
        if (!kind) {
          throw p.buildCodeFrameError(
            `memo-dom: handler updates '${arg.name}', which is neither module state nor a handler local`,
          );
        }
        if (kind !== 'let') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update '${arg.name}' — it is a const binding; mutate its contents instead`,
          );
        }

        scopeOf(p).writes.add(arg.name);
      } else if (t.isMemberExpression(arg)) {
        noteMemberWrite(p, arg);
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;

      // mutator-method calls, member-chain aware (M5.3): the chain's ROOT
      // decides — let → write to the variable; store → static dotted-path
      // write, dynamic chain → opaque
      if (t.isMemberExpression(callee)) {
        const prop = callee.property;
        const pn =
          !callee.computed && t.isIdentifier(prop)
            ? prop.name
            : callee.computed && t.isStringLiteral(prop)
              ? prop.value
              : null;
        if (pn !== null && MUTATOR_METHODS.has(pn)) {
          const obj = callee.object;
          const rootName = t.isIdentifier(obj)
            ? obj.name
            : t.isMemberExpression(obj)
              ? memberRootName(obj)
              : null;
          if (rootName && ctx.state.has(rootName)) {
            const kind = ctx.state.get(rootName)!;
            if (kind !== 'store') {
              // items.push(…) mutates the collection: a write to the variable
              scopeOf(p).writes.add(rootName);
            } else {
              const key = t.isMemberExpression(obj) ? memberKey(obj) : null;
              if (key !== null) {
                scopeOf(p).writes.add(key); // store.items.push → ['store.items']
              } else {
                // bare store mutator or dynamic chain — opaque
                ctx.opaqueVars.add(rootName);
                scopeOf(p).rootFallback = true;
              }
            }
          }
        }
        return;
      }

      // calls to module-level helpers: fold the callee's summary into this
      // scope (M5.3 — writes inside helpers used to vanish silently)
      if (t.isIdentifier(callee) && ctx.helpers.has(callee.name)) {
        const sum = summarizeHelper(ctx, callee.name);
        const s = scopeOf(p);
        for (const w of sum.writes) s.writes.add(w);
        if (sum.opaque) {
          for (const w of sum.writes) ctx.opaqueVars.add(w);
          s.rootFallback = true;
        }
      }
    },
  });

  // pass C: one commit per scope, appended inside the clone…
  for (const [fn, s] of scopes) {
    const commit = buildCommit(ctx, s, compName);
    if (!commit) continue;
    appendScopeCommit(
      fn as t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
      commit,
    );
  }
  // …then adopt the mutated body (params are untouched)
  rootFn.body = clonedFn.body;
}

/** The static commit form for one scope's write-set. */
function buildCommit(
  ctx: Ctx,
  s: { writes: Set<string>; rootFallback: boolean },
  compName: string | null,
): t.Statement | null {
  if (s.rootFallback) {
    return t.expressionStatement(
      t.callExpression(md('markDirtySubtree'), [t.stringLiteral(ctx.rootId)]),
    );
  }
  if (s.writes.size === 0) return null;

  const writeList = [...s.writes].sort();
  const allLocal =
    compName !== null && // module-level functions have no entity id
    !ctx.listedSites.has(compName) && // multi-instance is never local
    writeList.every((v) => {
      const readers = readersOfVar(ctx, v);
      return readers.size <= 1 && readers.has(compName);
    });
  if (allLocal) {
    return t.expressionStatement(
      t.callExpression(md('markDirty'), [t.identifier('id')]),
    );
  }
  return t.expressionStatement(
    t.callExpression(md('commitWrites'), [freshWriteConst(ctx, writeList)]),
  );
}

/**
 * Append a commit to a function body so it runs on EVERY exit path (M5.3):
 * a clone is inserted before each `return` belonging to this scope, and the
 * commit itself goes at the end. An implicit-return arrow (`() => expr`) is
 * wrapped so its return value survives (it can feed a promise chain).
 */
function appendScopeCommit(
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  commit: t.Statement,
): void {
  if (t.isBlockStatement(fn.body)) {
    insertBeforeReturns(fn.body, commit);
    fn.body.body.push(commit);
    return;
  }
  const ret = t.identifier('__memoRet');
  fn.body = t.blockStatement([
    t.variableDeclaration('const', [t.variableDeclarator(ret, fn.body as t.Expression)]),
    commit,
    t.returnStatement(t.identifier('__memoRet')),
  ]);
}

/**
 * Insert a clone of `commit` before every `return` in this scope. Nested
 * functions are skipped — their returns belong to their own scopes (and get
 * their own commits). A bare `if (x) return` consequent is wrapped in a
 * block. Writes followed by an early return used to commit never (dead code
 * after the return); now each exit path commits first.
 */
function insertBeforeReturns(node: t.Node, commit: t.Statement): void {
  if (t.isFunction(node)) return;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        const c = child[i];
        if (!c || typeof c !== 'object' || !('type' in c)) continue;
        if (t.isFunction(c)) continue;
        if (t.isReturnStatement(c)) {
          child.splice(i, 0, t.cloneNode(commit));
          i++;
          continue;
        }
        insertBeforeReturns(c as t.Node, commit);
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      if (t.isFunction(child)) continue;
      if (t.isReturnStatement(child)) {
        (node as any)[key] = t.blockStatement([
          t.cloneNode(commit),
          child as t.ReturnStatement,
        ]);
        continue;
      }
      insertBeforeReturns(child as t.Node, commit);
    }
  }
}

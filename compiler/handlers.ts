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
 * Commit form per scope:
 *   unbounded shared effect                → markDirtySubtree(rootId)
 *   exact or receiver-bounded state effect → commitWrites(WRITES_n)
 *   component instance / keyed-row effect  → direct local invalidation
 *
 * A method call on a reactive receiver is conservatively bounded to that
 * receiver. The compiler does not maintain built-in method semantics:
 * `items.push()` and `items.filter()` invalidate the same readers, whose
 * memoized update guards absorb unchanged values.
 */

import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  memberRootName,
  walkNodes,
  writeTouchesKey,
  type Ctx,
  type RowCtx,
} from './context';
import {
  appendScopeCommit,
  buildScopeCommit,
  createScopeWrites,
  type ScopeWrites,
} from './handler-commits';
import {
  buildEventOriginCommit,
  wrapSharedHandlerWithOrigin,
} from './handler-origin';
import {
  AliasTracker,
  callArgumentExpressions,
  extendOrigin,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from './mutation-analysis';
import { summarizeHelper } from './helper-summaries';

// @babel/traverse is CJS; under ESM the function lands on `.default`.
const traverse: typeof _traverse = (_traverse as any).default ?? (_traverse as any);

export type HandlerFn =
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | t.FunctionDeclaration;

/** Resolve a component-local helper declared directly in the factory body. */
export function resolveLocalHelper(
  compPath: NodePath<t.FunctionDeclaration>,
  name: string,
): HandlerFn | null {
  const binding = compPath.scope.getBinding(name);
  const decl = binding?.path;
  if (!decl || decl.getFunctionParent() !== compPath) return null;
  if (decl.isFunctionDeclaration()) return decl.node;
  if (!decl.isVariableDeclarator()) return null;
  const init = decl.node.init;
  return init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
    ? init
    : null;
}

/**
 * Instrument a callback that executes outside the component's synchronous
 * factory call. The callback owns its normal-exit commit; no event boundary
 * or exception wrapper is introduced.
 */
export function instrumentComponentCallback(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  target: HandlerFn,
  compName: string,
  rowCtx?: RowCtx,
): void {
  if (ctx.analyzedFunctions.has(target)) return;
  instrumentReachableLocalHelpers(ctx, compPath, target, compName, rowCtx);
  ctx.analyzedFunctions.add(target);
  analyzeHandler(ctx, target, compName, rowCtx, false);
}

/** Instrument a module-owned callback through canonical access-table writes. */
export function instrumentSharedCallback(
  ctx: Ctx,
  target: HandlerFn,
): void {
  if (ctx.analyzedFunctions.has(target)) return;
  ctx.analyzedFunctions.add(target);
  analyzeHandler(ctx, target, null, undefined, false);
}

/**
 * Instrument component-local helpers reachable from a handler. This closes
 * the stale-timer gap where `onClick={() => start()}` called
 * `start = () => setInterval(() => local++, 1000)`: the write lives in a
 * different function AST, so analyzing only the JSX handler cannot see it.
 */
function instrumentReachableLocalHelpers(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  root: HandlerFn,
  compName: string,
  rowCtx?: RowCtx,
): void {
  const names = new Set<string>();
  walkNodes(root.body, (node) => {
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
      names.add(node.callee.name);
    }
  });
  for (const name of names) {
    const helper = resolveLocalHelper(compPath, name);
    if (helper === null || ctx.analyzedFunctions.has(helper)) continue;
    ctx.analyzedFunctions.add(helper); // cycle guard
    instrumentReachableLocalHelpers(ctx, compPath, helper, compName, rowCtx);
    analyzeHandler(ctx, helper, compName, rowCtx, false);
  }
}

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
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
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
        forceTable =
          binding?.scope.path.isProgram() === true &&
          ctx.helpers.has(value.name);
      }
    } else if (decl && decl.isFunctionDeclaration()) {
      if (ctx.helpers.has(value.name)) {
        target = decl.node;
        forceTable = true;
      } else {
        target = resolveLocalHelper(compPath, value.name);
      }
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
    if (!forceTable) {
      instrumentReachableLocalHelpers(ctx, compPath, target, compName, rowCtx);
    }
    ctx.analyzedFunctions.add(target);
    // R11: a handler shared between a row and a non-row site is analyzed
    // with the FIRST site's row context — pass forceTable for non-row uses.
    analyzeHandler(
      ctx,
      target,
      forceTable ? null : compName,
      forceTable ? undefined : rowCtx,
      !forceTable && !t.isIdentifier(value),
      eventOriginId,
    );
  }
  if (forceTable) {
    const summary = summarizeHelper(ctx, (value as t.Identifier).name);
    if (target.async) {
      const immediate = createScopeWrites();
      for (const write of summary.writes) immediate.writes.add(write);
      for (const write of summary.boundedWrites) immediate.writes.add(write);
      immediate.rootFallback = summary.unbounded;
      return wrapSharedHandlerWithOrigin(
        ctx,
        value as t.Identifier,
        buildScopeCommit(ctx, immediate, null) ??
          buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
      );
    }
    if (
      summary.writes.size === 0 &&
      summary.boundedWrites.size === 0 &&
      !summary.unbounded
    ) {
      return wrapSharedHandlerWithOrigin(
        ctx,
        value as t.Identifier,
        buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
      );
    }
  }
  if (
    t.isIdentifier(value) &&
    !forceTable &&
    (ctx.handlerHasRootCommit.get(target) === false || target.async)
  ) {
    return wrapSharedHandlerWithOrigin(
      ctx,
      value,
      buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
    );
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
/**
 * R11.1: can anything OTHER than the row's own list observe item-field
 * mutations? The row-local commit (markDirty/update on the row alone) is
 * sound only when the answer is no. List owners are excluded — their
 * map-source read is inherent to the list pattern and the reconcile
 * resyncs their rows (see spec §11.3 for the residual case of an owner
 * deriving item fields inline, outside a computed).
 */
function itemFieldVisibleBeyondList(
  ctx: Ctx,
  compName: string | null,
  rowCtx: RowCtx,
): boolean {
  if (rowCtx.sourceLocal) return true;
  const source = rowCtx.sourceKey;
  if (source === '') return true; // unknown source -> conservative
  for (const info of ctx.computeds.values()) {
    if (info.reads.has(source)) return true;
  }
  const owners = new Set((ctx.listedSites.get(compName ?? '') ?? []).map((s) => s.owner));
  if (owners.size === 0 && compName !== null) owners.add(compName); // inline rows
  for (const reader of readersOfVar(ctx, source)) {
    if (reader === '__rows__' || reader === '__regions__') return true;
    if (!owners.has(reader)) return true;
  }
  return false;
}

function analyzeHandler(
  ctx: Ctx,
  rootFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  compName: string | null,
  rowCtx?: RowCtx,
  eventBoundary = false,
  eventOriginId?: t.Expression,
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

  const instVars = compName !== null ? ctx.instanceState.get(compName) : undefined;
  const instComputeds =
    compName !== null ? ctx.instanceComputeds.get(compName) : undefined;
  const propNames =
    compName !== null ? new Set(ctx.compPropNames.get(compName) ?? []) : new Set<string>();
  const componentLocals = new Set<string>([
    ...propNames,
    ...(instVars ?? []),
    ...(instComputeds?.keys() ?? []),
  ]);
  if (compName !== null) {
    for (const stmt of ctx.compPaths.get(compName)?.node.body.body ?? []) {
      if (t.isVariableDeclaration(stmt)) {
        for (const d of stmt.declarations) {
          if (t.isIdentifier(d.id)) componentLocals.add(d.id.name);
        }
      } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
        componentLocals.add(stmt.id.name);
      }
    }
  }

  const aliases = new AliasTracker((name, binding) => {
    if (binding !== undefined) return null;
    if (rowCtx !== undefined && name === rowCtx.itemParam) {
      return { locality: 'row', root: name, key: name };
    }
    if (instVars?.has(name) === true) {
      return { locality: 'instance', root: name, key: name };
    }
    if (propNames.has(name)) {
      return { locality: 'prop', root: name, key: name };
    }
    if (componentLocals.has(name)) return null;
    const kind = ctx.state.get(name);
    return kind === undefined ? null : moduleOrigin(name, kind);
  });

  const locals = new Set<string>();
  for (const param of clonedFn.params) {
    if (t.isIdentifier(param)) locals.add(param.name);
  }

  // pass A: locals declared anywhere inside the handler
  traverse(wrapper, {
    VariableDeclarator(p) {
      if (t.isIdentifier(p.node.id)) {
        locals.add(p.node.id.name);
        if (p.parentPath.isVariableDeclaration()) {
          aliases.trackDeclarator(p.scope, p.node);
        }
      }
    },
    Function(p) {
      for (const param of p.node.params) {
        if (t.isIdentifier(param)) locals.add(param.name);
      }
    },
  });

  // pass B: writes grouped by innermost enclosing function scope
  const scopes = new Map<t.Node, ScopeWrites>();
  const scopeOf = (p: NodePath): ScopeWrites => {
    const fn = p.getFunctionParent()?.node ?? ROOT;
    let s = scopes.get(fn);
    if (!s) {
      scopes.set(fn, (s = createScopeWrites()));
    }
    return s;
  };
  const noteSourceWrite = (p: NodePath): void => {
    const scope = scopeOf(p);
    if (rowCtx?.sourceLocal) {
      scope.rowOwnerLocal = true;
    } else if (rowCtx !== undefined) {
      scope.writes.add(rowCtx.sourceKey);
    }
  };

  // R11: a member write rooted at the row's item param. Non-key fields are
  // visible ONLY to this row's DOM → the commit is a local markDirty(rowId).
  // Key-field writes change the row identity → structural fallback: a normal
  // invalidation of the collection source (full reconcile, re-keys everything).
  const noteItemWrite = (p: NodePath, node: t.MemberExpression): boolean => {
    if (rowCtx === undefined) return false;
    if (memberRootName(node) !== rowCtx.itemParam) return false;
    const key = memberKey(node); // 'todo.done.x' or null when dynamic
    if (key === null) {
      // dynamic path on the item (todo[k] = …): may hit the key — fall back
      noteSourceWrite(p);
      return true;
    }
    const segs = key.split('.').slice(1); // strip the item param root
    if (writeTouchesKey(segs, rowCtx.keyPath)) {
      noteSourceWrite(p);
    } else {
      scopeOf(p).rowLocal = true;
      // R11.1: the row-local shortcut is only sound when NOTHING outside the
      // row's own list can observe item fields. A computed over the source
      // array (todos.filter(t => t.done).length) — or any non-owner reader —
      // sees field mutations too, so the array write must ALSO route through
      // the table: the computed recomputes, the reader re-renders, and the
      // resulting reconcile resyncs this row anyway (setter guards absorb
      // the overlap).
      if (itemFieldVisibleBeyondList(ctx, compName, rowCtx)) {
        noteSourceWrite(p);
      }
    }
    return true;
  };

  const noteOriginWrite = (p: NodePath, origin: ReactiveOrigin): void => {
    if (origin.locality === 'instance') {
      scopeOf(p).instanceLocal = true;
      return;
    }
    if (origin.locality === 'row') {
      if (rowCtx === undefined) {
        scopeOf(p).rootFallback = true;
        return;
      }
      if (origin.key === null) {
        noteSourceWrite(p);
        return;
      }
      const segs = origin.key.split('.').slice(1);
      if (writeTouchesKey(segs, rowCtx.keyPath)) {
        noteSourceWrite(p);
      } else {
        scopeOf(p).rowLocal = true;
        if (itemFieldVisibleBeyondList(ctx, compName, rowCtx)) {
          noteSourceWrite(p);
        }
      }
      return;
    }
    if (origin.locality === 'prop') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate prop '${origin.root}' outside a keyed row - copy it to component-local state first`,
      );
    }
    if (origin.stateKind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${origin.root}' (R13) - it is derived; write its SOURCE state instead`,
      );
    }
    if (origin.stateKind !== 'store') {
      scopeOf(p).writes.add(origin.root);
      return;
    }
    if (origin.key !== null && origin.key.includes('.')) {
      scopeOf(p).writes.add(origin.key);
    } else {
      // A dynamic store path is imprecise, but it is still bounded to the
      // store root. Prefix matching reaches every observer of that store.
      scopeOf(p).writes.add(origin.root);
    }
  };

  const noteReceiverEffect = (
    p: NodePath,
    origin: ReactiveOrigin,
  ): void => {
    if (origin.locality === 'instance') {
      scopeOf(p).instanceLocal = true;
      return;
    }
    if (origin.locality === 'row') {
      if (rowCtx === undefined) {
        scopeOf(p).rootFallback = true;
        return;
      }
      const receiverIsItem = origin.key === null || origin.key === origin.root;
      if (
        receiverIsItem &&
        (rowCtx.keyPath === null || rowCtx.keyPath.length > 0)
      ) {
        // An arbitrary item method can change the key, so re-establish row
        // identity through collection-view reconciliation.
        noteSourceWrite(p);
      } else {
        noteOriginWrite(p, origin);
      }
      return;
    }
    if (origin.locality === 'prop') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot call a stateful method on prop '${origin.root}' outside a keyed row - copy it to component-local state first`,
      );
    }
    if (origin.stateKind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${origin.root}' (R13) - write its SOURCE state instead`,
      );
    }
    scopeOf(p).writes.add(origin.key ?? origin.root);
  };

  const noteBoundedArguments = (
    p: NodePath,
    args: t.CallExpression['arguments'],
  ): void => {
    for (const expression of callArgumentExpressions(args)) {
      // A member expression passes its resulting value, not necessarily the
      // reactive container. Property-value semantics remain author-owned.
      if (!t.isIdentifier(expression)) continue;
      const origin = aliases.resolveExpression(p.scope, expression);
      if (origin !== null) noteReceiverEffect(p, origin);
    }
  };

  const noteMemberWrite = (p: NodePath, node: t.MemberExpression): void => {
    const rootName = memberRootName(node);
    if (rootName !== undefined && instVars?.has(rootName ?? '') === true) {
      // R12: mutating a field of an instance-state object — same local commit
      scopeOf(p).instanceLocal = true;
      return;
    }
    if (rootName !== null && instComputeds?.has(rootName)) {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate per-instance derivation '${rootName}' (R14) — write its source instead`,
      );
    }
    if (noteItemWrite(p, node)) return;
    const origin = aliases.resolveExpression(p.scope, node);
    if (origin !== null) {
      noteOriginWrite(p, origin);
      return;
    }
    if (rootName !== null && propNames.has(rootName)) {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate prop '${rootName}' outside a keyed row — copy it to component-local state first`,
      );
    }
    if (rootName !== null && componentLocals.has(rootName)) return;
    if (!rootName || !ctx.state.has(rootName)) return;
    const kind = ctx.state.get(rootName)!;
    if (kind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${rootName}' (R13) — it is derived; write its SOURCE state instead`,
      );
    }
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
      s.writes.add(rootName);
    }
  };

  // R12: instance state of the enclosing component — writes are always a
  // bare markDirty(id), never table routing (the closure belongs to one
  // instance; listed components included).
  traverse(wrapper, {
    VariableDeclarator(p) {
      if (
        !t.isIdentifier(p.node.id) &&
        p.node.init !== null
      ) {
        for (
          const origin of aliases.referencedOrigins(
            p.scope,
            p.node.init as t.Expression,
          )
        ) {
          noteReceiverEffect(p, origin);
        }
      }
    },
    AssignmentExpression(p) {
      const left = p.node.left;
      if (t.isIdentifier(left)) {
        if (locals.has(left.name)) {
          if (t.isIdentifier(p.node.right)) {
            const origin = aliases.resolveExpression(p.scope, p.node.right);
            if (origin !== null) noteReceiverEffect(p, origin);
          }
          return;
        }
        if (instComputeds?.has(left.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot assign per-instance derivation '${left.name}' (R14) — write its source instead`,
          );
        }
        if (instVars?.has(left.name) === true) {
          scopeOf(p).instanceLocal = true; // R12: per-instance, no table
          return;
        }
        if (propNames.has(left.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot assign prop '${left.name}' — copy it to component-local let state first`,
          );
        }
        if (componentLocals.has(left.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot assign component-local const '${left.name}'`,
          );
        }
        const kind = ctx.state.get(left.name);
        if (!kind) {
          throw p.buildCodeFrameError(
            `memo-dom: handler assigns '${left.name}', which is neither module state nor a handler local — declare it at module level (let) or inside the handler`,
          );
        }
        if (ctx.importedState.has(left.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign imported state '${left.name}' - ES module imports are read-only; export a mutator or mutate an imported store property`,
          );
        }
        if (kind === 'store') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign store '${left.name}' — assign a property (${left.name}.field = …) instead`,
          );
        }
        if (kind === 'const') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign mutable const root '${left.name}' - mutate the object instead`,
          );
        }
        if (kind === 'computed') {
          throw p.buildCodeFrameError(
            `memo-dom: cannot assign computed '${left.name}' (R13) — it is derived; write its SOURCE state instead and the derivation recomputes`,
          );
        }
        scopeOf(p).writes.add(left.name);
      } else if (t.isMemberExpression(left)) {
        noteMemberWrite(p, left);
      } else {
        for (const origin of aliases.referencedOrigins(p.scope, p.node.right)) {
          noteReceiverEffect(p, origin);
        }
      }
    },
    UpdateExpression(p) {
      const arg = p.node.argument;
      if (t.isIdentifier(arg)) {
        if (locals.has(arg.name)) return;
        if (instComputeds?.has(arg.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update per-instance derivation '${arg.name}' (R14) — write its source instead`,
          );
        }
        if (instVars?.has(arg.name) === true) {
          scopeOf(p).instanceLocal = true; // R12
          return;
        }
        if (propNames.has(arg.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update prop '${arg.name}' — copy it to component-local let state first`,
          );
        }
        if (componentLocals.has(arg.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update component-local const '${arg.name}'`,
          );
        }
        const kind = ctx.state.get(arg.name);
        if (!kind) {
          throw p.buildCodeFrameError(
            `memo-dom: handler updates '${arg.name}', which is neither module state nor a handler local`,
          );
        }
        if (ctx.importedState.has(arg.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update imported state '${arg.name}' - ES module imports are read-only; call an exported mutator instead`,
          );
        }
        if (kind !== 'let') {
          throw p.buildCodeFrameError(
            kind === 'computed'
              ? `memo-dom: cannot update computed '${arg.name}' (R13) — it is derived; write its SOURCE state instead`
              : `memo-dom: cannot update '${arg.name}' — it is a const binding; mutate its contents instead`,
          );
        }
        scopeOf(p).writes.add(arg.name);
      } else if (t.isMemberExpression(arg)) {
        noteMemberWrite(p, arg);
      }
    },
    UnaryExpression(p) {
      if (
        p.node.operator === 'delete' &&
        t.isMemberExpression(p.node.argument)
      ) {
        noteMemberWrite(p, p.node.argument);
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;

      // Every method call on a reactive receiver has a bounded receiver
      // effect. No method-name purity/mutation table is consulted.
      if (t.isMemberExpression(callee)) {
        const method = memberName(callee);
        if (
          method === 'assign' &&
          t.isIdentifier(callee.object, { name: 'Object' })
        ) {
          const targetArg = p.node.arguments[0];
          const target =
            targetArg !== undefined && t.isExpression(targetArg)
              ? aliases.resolveExpression(p.scope, targetArg)
              : null;
          if (target !== null) {
            if (
              target.locality === 'module' &&
              target.stateKind === 'store'
            ) {
              const keys = staticAssignedKeys(target, p.node.arguments.slice(1));
              if (keys === null) {
                noteReceiverEffect(p, target);
              } else {
                for (const key of keys) scopeOf(p).writes.add(key);
              }
            } else {
              noteOriginWrite(p, target);
            }
          }
          return;
        }

        const receiverRoot = t.isIdentifier(callee.object)
          ? callee.object.name
          : t.isMemberExpression(callee.object)
            ? memberRootName(callee.object)
            : null;
        if (receiverRoot !== null && instComputeds?.has(receiverRoot)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot mutate per-instance derivation '${receiverRoot}' (R14) - write its source instead`,
          );
        }
        const receiver =
          t.isExpression(callee.object)
            ? aliases.resolveExpression(p.scope, callee.object)
            : null;
        if (receiver !== null) {
          noteReceiverEffect(p, receiver);
        } else {
          noteBoundedArguments(p, p.node.arguments);
        }
        return;
      }

      // calls to module-level helpers: fold the callee's summary into this
      // scope (M5.3 — writes inside helpers used to vanish silently)
      if (
        t.isIdentifier(callee) &&
        !componentLocals.has(callee.name) &&
        (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name))
      ) {
        const sum =
          ctx.importedFunctions.get(callee.name) ?? summarizeHelper(ctx, callee.name);
        const s = scopeOf(p);
        for (const w of sum.writes) s.writes.add(w);
        for (const w of sum.boundedWrites) s.writes.add(w);
        for (const effect of sum.parameterWrites) {
          const argument = p.node.arguments[effect.index];
          if (argument === undefined || !t.isExpression(argument)) continue;
          const origin = aliases.resolveExpression(p.scope, argument);
          if (origin !== null) {
            noteReceiverEffect(p, extendOrigin(origin, effect.path));
          }
        }
        if (sum.unbounded) {
          s.rootFallback = true;
        }
        return;
      }
      // Unknown direct calls are bounded to reactive arguments completed in
      // this call scope. Retained future callbacks remain lifecycle work.
      noteBoundedArguments(p, p.node.arguments);
    },
  });

  const rootHasCommit = scopes.has(ROOT);
  ctx.handlerHasRootCommit.set(rootFn, rootHasCommit);

  // A DOM event remains an invalidation boundary even when static analysis
  // finds no write in the handler itself. Start from its nearest entity.
  if (eventBoundary && !scopes.has(ROOT)) {
    const eventScope = createScopeWrites();
    eventScope.eventOrigin = buildEventOriginCommit(
      ctx,
      compName,
      rowCtx,
      eventOriginId,
    );
    scopes.set(ROOT, eventScope);
  }

  // pass C: one commit per scope, appended inside the clone…
  for (const [fn, s] of scopes) {
    const commit = buildScopeCommit(ctx, s, compName, rowCtx);
    if (!commit) continue;
    appendScopeCommit(
      ctx,
      fn as t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
      commit,
    );
  }
  // …then adopt the mutated body (params are untouched)
  rootFn.body = clonedFn.body;
}

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
import * as t from '@babel/types';
import {
  memberRootName,
  walkNodes,
  type Ctx,
  type RowCtx,
} from './context';
import {
  buildScopeCommit,
  createScopeWrites,
} from './handler-commits';
import {
  buildEventOriginCommit,
  wrapSharedHandlerWithOrigin,
} from './handler-origin';
import { summarizeHelper } from './helper-summaries';
import {
  objectBindingName,
  propNameForBinding,
} from './components/props';
import { analyzeHandler } from './handlers/analyze';

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
  executionAwareRoot = false,
): void {
  if (ctx.analyzedFunctions.has(target)) return;
  instrumentReachableLocalHelpers(ctx, compPath, target, compName, rowCtx);
  ctx.analyzedFunctions.add(target);
  analyzeHandler(
    ctx,
    target,
    compName,
    rowCtx,
    false,
    undefined,
    executionAwareRoot,
  );
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
  const propPlan = ctx.componentProps.get(compName);
  const propObject =
    propPlan === undefined ? null : objectBindingName(propPlan);
  const propHandler =
    propPlan !== undefined &&
    ((t.isIdentifier(value) &&
      propNameForBinding(propPlan, value.name) !== null) ||
      (t.isMemberExpression(value) &&
        propObject !== null &&
        memberRootName(value) === propObject));

  if (propHandler) {
    return wrapSharedHandlerWithOrigin(
      ctx,
      value,
      buildEventOriginCommit(
        ctx,
        compName,
        rowCtx,
        eventOriginId,
      ),
    );
  }

  if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
    target = value;
  } else if (t.isIdentifier(value)) {
    const imported = ctx.importedFunctions.get(value.name);
    if (imported !== undefined) {
      const writes = createScopeWrites();
      for (const write of imported.writes) writes.writes.add(write);
      for (const write of imported.boundedWrites) {
        writes.writes.add(write);
      }
      writes.rootFallback = imported.unbounded;
      return wrapSharedHandlerWithOrigin(
        ctx,
        value,
        buildScopeCommit(ctx, writes, null) ??
          buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
      );
    }

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

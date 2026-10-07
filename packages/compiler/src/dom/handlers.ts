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

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, type BaseNode } from '../ast';
import { generatedIdentifier } from './identifiers';
import { astBindingAt, memberRootName, variableDeclaratorFor, type ComponentPath, type RowCtx } from '../context';
import { type DomContext as Ctx } from './context';
import {
  buildScopeCommit,
} from './handler-commits';
import { createScopeWrites, recordRoutedWrite, type RowWriteFacts } from '../handlers/write-facts';
import {
  buildEventOriginCommit,
  wrapSharedHandlerWithOrigin,
} from './handler-origin';
import { summarizeHelper } from '../helper-summaries';
import {
  objectBindingName,
  propNameForBinding,
} from '../components/props';
import { planHandlerWrites } from '../handlers/analyze';
import { emitHandlerWrites } from './handler';
import { mutationJournalVariable } from './list-bindings';
import { callsOnlyCommittedLocalHelpers } from '../handlers/local-calls';
import {hasConditionalRootExecution,resolveLocalHelper} from '../planning/component-callbacks';
import type {CallbackSourcePlan,ComponentCallbacks} from '../planning/component-callbacks';
import {emitComponentCallback} from './component-callback';

/** The coordinator owns the transition from captured writes to DOM lowering. */
function analyzeHandler(
  ctx:Ctx, target:HandlerFn, owner:string|null, row?:RowCtx,
  eventBoundary=false, eventOriginId?:t.Expression, executionAwareRoot=false,source?:CallbackSourcePlan|null,
): void {
  const rowFacts:RowWriteFacts|undefined = row === undefined ? undefined : {
    itemParam:row.itemParam, itemPath:[...row.itemPath], keyPath:row.keyPath === null ? null : [...row.keyPath],
    sourceKey:row.sourceKey, sourceLocal:row.sourceLocal, localRefresh:row.refreshVar !== undefined,
  };
  const journals = owner === null ? undefined : new Map(
    [...ctx.keyedListMutationSources.get(owner)?.keys() ?? []].map(source=>[source,mutationJournalVariable(ctx,owner,source)]),
  );
  const writes=source?source.writesFor(rowFacts,eventBoundary):
    owner===null&&ctx.moduleCallbacks!==null?ctx.moduleCallbacks.writesFor(target,executionAwareRoot):
      planHandlerWrites(ctx,target,owner,rowFacts,eventBoundary,executionAwareRoot);
  emitHandlerWrites(ctx,writes,{row,eventOriginId,journals});
}

export type HandlerFn =
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | t.FunctionDeclaration;

/** Instrument a module-owned callback through canonical access-table writes. */
export function instrumentSharedCallback(
  ctx: Ctx,
  target: HandlerFn,
  executionAwareRoot = false,
): void {
  if (ctx.analyzedFunctions.has(target)) return;
  ctx.analyzedFunctions.add(target);
  if(ctx.moduleCallbacks===null)throw new Error('memo-dom: module callbacks were not planned before DOM lowering');
  emitHandlerWrites(ctx,ctx.moduleCallbacks.writesFor(target,executionAwareRoot));
}

/**
 * Resolve a JSX handler attribute to an analyzable function, augmenting
 * named `const` handlers in place. Returns the expression to assign.
 */
export function buildHandler(
  ctx: Ctx,
  compPath: ComponentPath,
  value: t.Expression,
  attrName: string,
  compName: string,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  callbacks?:ComponentCallbacks|null,
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
    ((astFactory.isIdentifier(value) &&
      propNameForBinding(propPlan, value.name) !== null) ||
      (astFactory.isMemberExpression(value) &&
        propObject !== null &&
        memberRootName(value) === propObject));

  if (propHandler) {
    // Use the same linked effects as an authored `event => props.run(event)`.
    // The callback value and receiver remain intact; commits follow normal exit.
    const event = generatedIdentifier(ctx, 'event');
    const handler = astFactory.arrowFunctionExpression([event],
      astFactory.callExpression(cloneNode(value), [cloneNode(event)]));
    analyzeHandler(ctx, handler, compName, rowCtx, true, eventOriginId);
    return handler;
  }

  // A compiler-recognized form owns its own submission lifecycle and publishes
  // invalidations. Preserve the receiver when passing form.submit as a handler.
  if (
    attrName === 'onSubmit' &&
    astFactory.isMemberExpression(value) &&
    !value.computed &&
    astFactory.isIdentifier(value.property, { name: 'submit' })
  ) {
    return wrapSharedHandlerWithOrigin(
      ctx,
      value,
      buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
    );
  }

  if (astFactory.isArrowFunctionExpression(value) || astFactory.isFunctionExpression(value)) {
    target = value;
  } else if (astFactory.isIdentifier(value)) {
    const imported = ctx.importedFunctions.get(value.name);
    if (imported !== undefined) {
      const writes = createScopeWrites();
      for (const write of imported.writes) recordRoutedWrite(writes, write);
      for (const write of imported.boundedWrites) {
        recordRoutedWrite(writes, write);
      }
      writes.rootFallback = imported.unbounded;
      return wrapSharedHandlerWithOrigin(
        ctx,
        value,
        buildScopeCommit(ctx, writes, null) ??
          buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
      );
    }

    const binding = astBindingAt(
      ctx,
      compPath.node as unknown as BaseNode,
      value.name,
    );
    const declaration =
      binding === undefined ? null : variableDeclaratorFor(ctx, binding);
    if (declaration !== null) {
      const init = declaration.init;
      if (init && (astFactory.isArrowFunctionExpression(init) || astFactory.isFunctionExpression(init))) {
        target = init;
        forceTable =
          binding?.scope.isProgramScope === true &&
          ctx.helpers.has(value.name);
      }
    } else if (binding?.declarationNode.type === 'FunctionDeclaration') {
      if (ctx.helpers.has(value.name)) {
        target = binding.declarationNode as unknown as t.FunctionDeclaration;
        forceTable = true;
      } else {
        target = resolveLocalHelper(ctx, compPath, value.name);
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

  const source=!forceTable?callbacks?.forEvent(value,hasConditionalRootExecution(target)):null;
  // Module/generated callbacks are planned here. Authored native callbacks
  // keep their captured body until the backend consumes its source contract.
  if (!source && !astFactory.isBlockStatement(target.body)) {
    target.body = astFactory.blockStatement([
      astFactory.returnStatement(target.body as t.Expression),
    ]);
  }

  // a shared declaration (used by several attributes) is analyzed once
  if (!ctx.analyzedFunctions.has(target)) {
    if (!forceTable) {
      for(const helper of source?.helpers??[])emitComponentCallback(ctx,helper);
    }
    const committedLocalDelegation =
      !forceTable &&
      !astFactory.isIdentifier(value) &&
      callsOnlyCommittedLocalHelpers(target, (name) => {
        const helper = resolveLocalHelper(ctx, compPath, name);
        return (
          helper !== null &&
          ctx.handlerHasRootCommit.get(helper) === true
        );
      });
    ctx.analyzedFunctions.add(target);
    // R11: a handler shared between a row and a non-row site is analyzed
    // with the FIRST site's row context — pass forceTable for non-row uses.
    // A handler RESOLVED BY NAME lives at component scope, so row-scoped
    // commit identifiers are never valid inside it — analyze it without the
    // row context even when the reference site is a row.
    const nameResolved = astFactory.isIdentifier(value) && !forceTable && rowCtx?.refreshVar === undefined;
    const directEventBoundary =
      !forceTable &&
      !target.async &&
      (!astFactory.isIdentifier(value) || target.params.length > 0) &&
      !committedLocalDelegation;
    analyzeHandler(
      ctx,
      target,
      forceTable ? null : compName,
      nameResolved ? undefined : rowCtx,
      directEventBoundary,
      eventOriginId,
      !forceTable && hasConditionalRootExecution(target),
      source,
    );
  }
  if (forceTable) {
    const summary = summarizeHelper(ctx, (value as t.Identifier).name);
    if (target.async) {
      const immediate = createScopeWrites();
      for (const write of summary.writes) recordRoutedWrite(immediate, write);
      for (const write of summary.boundedWrites) {
        recordRoutedWrite(immediate, write);
      }
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
    astFactory.isIdentifier(value) &&
    !forceTable &&
    (ctx.handlerHasRootCommit.get(target) === false || target.async)
  ) {
    return wrapSharedHandlerWithOrigin(
      ctx,
      value,
      buildEventOriginCommit(ctx, compName, rowCtx, eventOriginId),
    );
  }
  return astFactory.isIdentifier(value) ? value : (target as t.Expression);
}

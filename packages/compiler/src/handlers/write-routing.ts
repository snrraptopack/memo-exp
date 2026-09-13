import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  memberKey,
  memberRootName,
  writeTouchesKey,
  type Ctx,
  type KeyedListMutationPlan,
  type RowCtx,
} from '../context';
import {
  createScopeWrites,
  recordInstanceWrite,
  recordRoutedWrite,
  type ScopeWrites,
} from '../handler-commits';
import {
  callArgumentExpressions,
  type AliasTracker,
  type ReactiveOrigin,
} from '../mutation-analysis';
import { isStaticDerivedListConst } from '../lists/static-derived';
import { applyLinkedPropEffect } from '../components/prop-effects';
import {
  directListItemMutationKey,
  itemFieldVisibleBeyondList,
} from './mutation-targets';
import { HandlerPath, walkHandler, type FunctionNode } from './traversal';
import type { HandlerExecutionSite } from './execution-sites';
import { hasKnownAccessor } from './member-assignment';

export interface HandlerWriteRouting {
  locals: Set<string>;
  rootParamIndex: Map<string, number>;
  scopes: Map<t.Node, ScopeWrites>;
  executionSites: Map<t.Node, HandlerExecutionSite>;
  mutateScope(path: HandlerPath, mutate: (scope: ScopeWrites) => void): void;
  recordInstanceMutation(
    scope: ScopeWrites,
    source: string,
    kind?: 'targeted' | 'structural',
  ): void;
  noteReceiverEffect(path: HandlerPath, origin: ReactiveOrigin): void;
  noteMemberWrite(path: HandlerPath, node: t.MemberExpression): void;
  noteBoundedArguments(
    path: HandlerPath,
    args: t.CallExpression['arguments'],
  ): void;
  noteOriginWrite(path: HandlerPath, origin: ReactiveOrigin): void;
  isComputedOrigin(origin: ReactiveOrigin): boolean;
}

export function createHandlerWriteRouting({
  ctx,
  rootFn,
  clonedFn,
  root,
  componentName,
  rowContext,
  executionAwareRoot,
  aliases,
  instanceVariables,
  instanceDerivations,
  projectedProps,
  propNames,
  componentLocals,
  transparentRootFor,
}: {
  ctx: Ctx;
  rootFn: FunctionNode;
  clonedFn: FunctionNode;
  root: t.Node;
  componentName: string | null;
  rowContext: RowCtx | undefined;
  executionAwareRoot: boolean;
  aliases: AliasTracker;
  instanceVariables: Set<string> | undefined;
  instanceDerivations: Set<string> | undefined;
  projectedProps: Map<string, ReactiveOrigin>;
  propNames: Set<string>;
  componentLocals: Set<string>;
  transparentRootFor(expression: t.Expression): string | null;
}): HandlerWriteRouting {
  const ROOT = root;
  const wrapper = clonedFn;
  const compName = componentName;
  const rowCtx = rowContext;
  const instVars = instanceVariables;
  const instDerived = instanceDerivations;
  const isComputedOrigin = (origin: ReactiveOrigin): boolean =>
    origin.stateKind === 'computed' || ctx.state.get(origin.root) === 'computed';
  const listMutationPlans =
    compName === null
      ? undefined
      : ctx.keyedListMutationSources.get(compName);
  const recordInstanceMutation = (
    scope: ScopeWrites,
    source: string,
    kind: 'targeted' | 'structural' = 'structural',
  ): void => {
    recordInstanceWrite(scope, source);
    const plan = listMutationPlans?.get(source);
    if (plan !== undefined) {
      recordInstanceWrite(
        scope,
        kind === 'targeted'
          ? plan.targetedReason
          : plan.structuralReason,
      );
    }
  };
  const journalTargetedMutation = (
    p: HandlerPath,
    plan: KeyedListMutationPlan,
    key: t.Expression,
  ): void => {
    if (!p.isExpression()) return;
    const original = cloneEstreeNode(p.node, true);
    p.replaceWith(
      astFactory.sequenceExpression([
        astFactory.callExpression(
          astFactory.memberExpression(
            astFactory.identifier(plan.keysVariable),
            astFactory.identifier('add'),
          ),
          [key],
        ),
        original,
      ]),
    );
    p.skip();
  };

  const locals = new Set<string>();
  for (const param of clonedFn.params) {
    if (astFactory.isIdentifier(param)) locals.add(param.name);
  }
  // Direct parameters of THIS function. Member writes rooted at them are
  // effects the function performs on its arguments — recorded so call sites
  // can route them through their own (possibly row-scoped) context.
  const rootParamIndex = new Map<string, number>(
    clonedFn.params.flatMap((param, index) =>
      astFactory.isIdentifier(param) ? [[param.name, index] as const] : [],
    ),
  );

  // pass A: locals declared anywhere inside the handler
  walkHandler(wrapper, {
    VariableDeclarator(p) {
      if (astFactory.isIdentifier(p.node.id)) {
        locals.add(p.node.id.name);
        if (p.parentPath?.isVariableDeclaration() === true) {
          aliases.trackDeclarator(p.scope, p.node);
        }
      }
    },
    Function(p) {
      for (const param of p.node.params) {
        if (astFactory.isIdentifier(param)) locals.add(param.name);
      }
    },
  }, ctx.moduleId);

  // pass B: writes grouped by innermost enclosing function scope
  const scopes = new Map<t.Node, ScopeWrites>();
  const executionSites = new Map<t.Node, HandlerExecutionSite>();
  const scopeOf = (p: HandlerPath): ScopeWrites => {
    const fn = p.getFunctionParent()?.node ?? ROOT;
    let s = scopes.get(fn);
    if (!s) {
      scopes.set(fn, (s = createScopeWrites()));
    }
    return s;
  };
  const mutateScope = (
    p: HandlerPath,
    mutate: (scope: ScopeWrites) => void,
  ): void => {
    mutate(scopeOf(p));
    if (
      !executionAwareRoot ||
      p.getFunctionParent()?.node !== ROOT
    ) {
      return;
    }
    let site = executionSites.get(p.node);
    if (site === undefined) {
      site = { path: p, writes: createScopeWrites() };
      executionSites.set(p.node, site);
    }
    mutate(site.writes);
  };
  const noteSourceWrite = (p: HandlerPath): void => {
    mutateScope(p, (scope) => {
      if (rowCtx?.sourceLocal) {
        scope.rowOwnerLocal = true;
      } else if (rowCtx !== undefined) {
        recordRoutedWrite(scope, rowCtx.sourceKey);
      }
    });
  };
  const rowRelativePath = (originKey: string): string[] | null => {
    if (rowCtx === undefined) return null;
    const segments = originKey.split('.').slice(1);
    if (
      rowCtx.itemPath.some(
        (segment, index) => segments[index] !== segment,
      )
    ) {
      return null;
    }
    return segments.slice(rowCtx.itemPath.length);
  };
  const noteNonItemRowProp = (
    p: HandlerPath,
    origin?: ReactiveOrigin,
  ): void => {
    mutateScope(p, (scope) => {
      if (
        origin !== undefined &&
        compName !== null &&
        applyLinkedPropEffect(ctx, compName, rowCtx, origin, scope)
      ) {
        return;
      }
      scope.rowLocal = true;
      scope.rootFallback = true;
    });
  };
  const notePropWrite = (
    p: HandlerPath,
    origin: ReactiveOrigin,
  ): void => {
    mutateScope(p, (scope) => {
      if (
        compName === null ||
        !applyLinkedPropEffect(ctx, compName, rowCtx, origin, scope)
      ) {
        if (rowCtx === undefined) {
          if (compName !== null) {
            recordInstanceWrite(scope, origin.root);
          }
          scope.rootFallback = true;
        } else {
          scope.rowLocal = true;
          scope.rootFallback = true;
        }
      }
    });
  };

  // R11: a member write rooted at the row's item param. Non-key fields are
  // visible ONLY to this row's DOM → the commit is a local markDirty(rowId).
  // Key-field writes change the row identity → structural fallback: a normal
  // invalidation of the collection source (full reconcile, re-keys everything).
  const noteItemWrite = (p: HandlerPath, node: t.MemberExpression): boolean => {
    if (rowCtx === undefined) return false;
    if (memberRootName(node) !== rowCtx.itemParam) return false;
    const key = memberKey(node); // 'todo.done.x' or null when dynamic
    if (key === null) {
      // dynamic path on the item (todo[k] = …): may hit the key — fall back
      if (rowCtx.itemPath.length === 0) {
        noteSourceWrite(p);
      } else {
        noteNonItemRowProp(p);
      }
      return true;
    }
    const segs = key.split('.').slice(1);
    if (
      rowCtx.itemPath.some(
        (segment, index) => segs[index] !== segment,
      )
    ) {
      return false;
    }
    segs.splice(0, rowCtx.itemPath.length);
    if (writeTouchesKey(segs, rowCtx.keyPath)) {
      noteSourceWrite(p);
    } else {
      mutateScope(p, (scope) => {
        scope.rowLocal = true;
      });
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

  const noteOriginWrite = (p: HandlerPath, origin: ReactiveOrigin): void => {
    if (origin.locality === 'instance') {
      mutateScope(p, (scope) => {
        recordInstanceMutation(scope, origin.root);
      });
      return;
    }
    if (origin.locality === 'row') {
      if (rowCtx === undefined) {
        mutateScope(p, (scope) => {
          scope.rootFallback = true;
        });
        return;
      }
      if (origin.key === null) {
        if (rowCtx.itemPath.length === 0) {
          noteSourceWrite(p);
        } else {
          noteNonItemRowProp(p);
        }
        return;
      }
      const segs = rowRelativePath(origin.key);
      if (segs === null) {
        noteNonItemRowProp(p, origin);
        return;
      }
      if (writeTouchesKey(segs, rowCtx.keyPath)) {
        noteSourceWrite(p);
      } else {
        mutateScope(p, (scope) => {
          scope.rowLocal = true;
        });
        if (itemFieldVisibleBeyondList(ctx, compName, rowCtx)) {
          noteSourceWrite(p);
        }
      }
      return;
    }
    if (origin.locality === 'prop') {
      notePropWrite(p, origin);
      return;
    }
    if (origin.stateKind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${origin.root}' (R13) - it is derived; write its SOURCE state instead`,
      );
    }
    if (origin.stateKind !== 'store') {
      mutateScope(p, (scope) => {
        recordRoutedWrite(scope, origin.root);
      });
      return;
    }
    if (origin.key !== null && origin.key.includes('.')) {
      mutateScope(p, (scope) => {
        recordRoutedWrite(scope, origin.key!);
      });
    } else {
      // A dynamic store path is imprecise, but it is still bounded to the
      // store root. Prefix matching reaches every observer of that store.
      mutateScope(p, (scope) => {
        recordRoutedWrite(scope, origin.root);
      });
    }
  };

  const noteReceiverEffect = (
    p: HandlerPath,
    origin: ReactiveOrigin,
  ): void => {
    if (origin.locality === 'instance') {
      mutateScope(p, (scope) => {
        recordInstanceMutation(scope, origin.root);
      });
      return;
    }
    if (origin.locality === 'row') {
      if (rowCtx === undefined) {
        mutateScope(p, (scope) => {
          scope.rootFallback = true;
        });
        return;
      }
      if (origin.key === null) {
        if (rowCtx.itemPath.length === 0) {
          noteSourceWrite(p);
        } else {
          noteNonItemRowProp(p);
        }
        return;
      }
      const relative = rowRelativePath(origin.key);
      if (relative === null) {
        noteNonItemRowProp(p, origin);
        return;
      }
      const receiverIsItem = relative.length === 0;
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
      notePropWrite(p, origin);
      return;
    }
    // A receiver call is an opaque invocation, not a proven assignment to
    // the derived binding. Conservatively invalidate its readers without
    // guessing whether a user-defined or third-party method is mutating.
    if (origin.stateKind === 'computed') {
      mutateScope(p, (scope) => {
        recordRoutedWrite(scope, origin.root);
      });
      return;
    }
    mutateScope(p, (scope) => {
      const source = origin.key ?? origin.root;
      recordRoutedWrite(scope, source, ctx.listSources.has(source));
    });
  };

  const noteBoundedArguments = (
    p: HandlerPath,
    args: t.CallExpression['arguments'],
  ): void => {
    if (
      executionAwareRoot &&
      p.getFunctionParent()?.node === ROOT
    ) {
      // The direct effect body is an external-synchronization boundary.
      // Passing reactive values to unknown APIs is consumption, not a hidden
      // reactive mutation; otherwise calls such as console.log(count) would
      // commit count and subscribe-trigger themselves forever. Visible helper
      // summaries and direct receiver mutations remain writable paths.
      return;
    }
    for (const expression of callArgumentExpressions(args)) {
      // A member expression passes its resulting value, not necessarily the
      // reactive container. Property-value semantics remain author-owned.
      if (!astFactory.isIdentifier(expression)) continue;
      const origin = aliases.resolveExpression(p.scope, expression);
      if (origin === null) continue;
      // Computeds are read-only derived values. Passing/capturing one through
      // an arbitrary utility is value consumption, not a visible mutation. If
      // user code mutates it behind an unanalyzable boundary, that mutation is
      // intentionally outside the reactive write model and will not propagate.
      // Direct visible writes/mutators still throw in noteOriginWrite and
      // noteReceiverEffect.
      if (isComputedOrigin(origin)) continue;
      noteReceiverEffect(p, origin);
    }
  };

  const noteMemberWrite = (p: HandlerPath, node: t.MemberExpression): void => {
    if (hasKnownAccessor(ctx, rootFn, node)) {
      mutateScope(p, scope => { scope.rootFallback = true; });
    }
    const rootName = memberRootName(node);
    if (
      rootName !== null &&
      isStaticDerivedListConst(ctx, rootName, compName)
    ) {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate '${rootName}' - it is derived from a static source and will never change`,
      );
    }
    const transparentRoot = transparentRootFor(node);
    if (transparentRoot !== null) {
      mutateScope(p, (scope) => scope.transparentWrites.add(transparentRoot));
      return;
    }
    if (rootName !== undefined && instVars?.has(rootName ?? '') === true) {
      const plan = listMutationPlans?.get(rootName!);
      const key =
        plan === undefined
          ? null
          : directListItemMutationKey(node, plan);
      mutateScope(p, (scope) => {
        recordInstanceMutation(
          scope,
          rootName!,
          key === null ? 'structural' : 'targeted',
        );
      });
      if (plan !== undefined && key !== null) {
        journalTargetedMutation(p, plan, key);
      }
      return;
    }
    const receiverKey = astFactory.isIdentifier(node.object)
      ? node.object.name
      : astFactory.isMemberExpression(node.object)
        ? memberKey(node.object)
        : null;
    if (receiverKey !== null && ctx.listSources.has(receiverKey)) {
      mutateScope(p, (scope) => {
        recordRoutedWrite(scope, receiverKey, true);
      });
      return;
    }
    if (
      rootName !== null &&
      instDerived?.has(rootName) &&
      !projectedProps.has(rootName)
    ) {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate per-instance derivation '${rootName}' (R14) — write its source instead`,
      );
    }
    if (noteItemWrite(p, node)) return;
    // Without a row context, a member write rooted at one of this function's
    // own parameters cannot be committed here (row identifiers do not exist
    // in this scope). Record it as a parameter effect for call sites to fold.
    if (
      rowCtx === undefined &&
      rootName !== null &&
      rootParamIndex.has(rootName)
    ) {
      const key = memberKey(node);
      if (key !== null) {
        const relative = key.split('.').slice(1);
        const recorded = ctx.localParamEffects.get(rootFn) ?? [];
        const entry = {
          index: rootParamIndex.get(rootName)!,
          path: relative,
        };
        if (
          !recorded.some(
            (existing) =>
              existing.index === entry.index &&
              existing.path.join('.') === entry.path.join('.'),
          )
        ) {
          recorded.push(entry);
          ctx.localParamEffects.set(rootFn, recorded);
        }
      }
      mutateScope(p, (scope) => {
        scope.rootFallback = true;
      });
      return;
    }
    const origin = aliases.resolveExpression(p.scope, node);
    if (origin !== null) {
      noteOriginWrite(p, origin);
      return;
    }
    if (rootName !== null && propNames.has(rootName)) {
      notePropWrite(p, {
        locality: 'prop',
        root: rootName,
        key: memberKey(node),
      });
      return;
    }
    if (rootName !== null && componentLocals.has(rootName)) return;
    if (!rootName || !ctx.state.has(rootName)) return;
    const kind = ctx.state.get(rootName)!;
    if (kind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${rootName}' (R13) — it is derived; write its SOURCE state instead`,
      );
    }
    mutateScope(p, (scope) => {
      if (kind !== 'store') {
        // reads of root-keyed vars (let/const): any member write is a write
        // to the variable (items[0] = x, items.length = 0, …)
        recordRoutedWrite(scope, rootName);
        return;
      }
      const key = memberKey(node);
      if (key !== null && key.includes('.')) {
        recordRoutedWrite(scope, key);
      } else {
        recordRoutedWrite(scope, rootName);
      }
    });
  };
  return {
    locals,
    rootParamIndex,
    scopes,
    executionSites,
    mutateScope,
    recordInstanceMutation,
    noteReceiverEffect,
    noteMemberWrite,
    noteBoundedArguments,
    noteOriginWrite,
    isComputedOrigin,
  };
}

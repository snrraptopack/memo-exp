import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  memberRootName,
  writeTouchesKey,
  type Ctx,
  type KeyedListMutationPlan,
  type RowCtx,
} from '../context';
import {
  appendScopeCommit,
  buildScopeCommit,
  createScopeWrites,
  recordInstanceWrite,
  type ScopeWrites,
} from '../handler-commits';
import { buildEventOriginCommit } from '../handler-origin';
import {
  AliasTracker,
  callArgumentExpressions,
  extendOrigin,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from '../mutation-analysis';
import { summarizeHelper } from '../helper-summaries';
import { applyLinkedPropEffect } from '../components/prop-effects';
import {
  componentPropProjectionOrigins,
} from '../components/prop-projections';
import { generatedIdentifier } from '../identifiers';
import { transparentListExpression } from '../lists/source-shapes';

const traverse: typeof _traverse =
  (_traverse as any).default ?? (_traverse as any);

const ARRAY_TOPOLOGY_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

function directListItemMutationKey(
  node: t.MemberExpression,
  plan: KeyedListMutationPlan,
): t.Expression | null {
  const chain: t.MemberExpression[] = [];
  let current: t.Expression = node;
  for (;;) {
    current = transparentListExpression(current);
    if (!t.isMemberExpression(current)) break;
    chain.unshift(current);
    if (t.isSuper(current.object)) return null;
    current = current.object;
  }
  if (!t.isIdentifier(current, { name: plan.source })) return null;
  const itemAccess = chain[0];
  if (
    itemAccess === undefined ||
    !itemAccess.computed ||
    !t.isExpression(itemAccess.property) ||
    !(
      t.isIdentifier(itemAccess.property) ||
      t.isNumericLiteral(itemAccess.property) ||
      t.isStringLiteral(itemAccess.property)
    ) ||
    chain.length < 2
  ) {
    return null;
  }

  const writtenSegments: string[] = [];
  for (const member of chain.slice(1)) {
    if (!member.computed && t.isIdentifier(member.property)) {
      writtenSegments.push(member.property.name);
    } else if (member.computed && t.isStringLiteral(member.property)) {
      writtenSegments.push(member.property.value);
    } else {
      return null;
    }
  }
  if (writeTouchesKey(writtenSegments, plan.keyPath)) return null;

  let key: t.Expression = t.cloneNode(itemAccess, true);
  for (const segment of plan.keyPath) {
    key = t.memberExpression(key, t.identifier(segment));
  }
  return key;
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

export function analyzeHandler(
  ctx: Ctx,
  rootFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  compName: string | null,
  rowCtx?: RowCtx,
  eventBoundary = false,
  eventOriginId?: t.Expression,
  executionAwareRoot = false,
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
  const instDerived =
    compName !== null ? ctx.instanceDerivedBindings.get(compName) : undefined;
  const projectedProps =
    compName === null
      ? new Map<string, ReactiveOrigin>()
      : componentPropProjectionOrigins(ctx, compName);
  const propNames =
    compName !== null
      ? new Set(ctx.componentProps.get(compName)?.bindings ?? [])
      : new Set<string>();
  const componentLocals = new Set<string>([
    ...propNames,
    ...(instVars ?? []),
    ...(instDerived ?? []),
  ]);
  if (compName !== null) {
    for (const stmt of ctx.compPaths.get(compName)?.node.body.body ?? []) {
      if (t.isVariableDeclaration(stmt)) {
        for (const d of stmt.declarations) {
          for (const name of Object.keys(t.getBindingIdentifiers(d.id))) {
            componentLocals.add(name);
          }
        }
      } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
        componentLocals.add(stmt.id.name);
      }
    }
  }

  const aliases = new AliasTracker((name, binding) => {
    if (binding !== undefined) return null;
    const projected = projectedProps.get(name);
    if (projected !== undefined) return projected;
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
  const isComputedOrigin = (origin: ReactiveOrigin): boolean =>
    origin.stateKind === 'computed' || ctx.state.get(origin.root) === 'computed';
  const listMutationPlans =
    compName === null
      ? undefined
      : ctx.keyedListMutationSources.get(compName);
  const recordInstanceMutation = (
    scope: ScopeWrites,
    source: string,
    kind: 'targeted' | 'topology' | 'structural' = 'structural',
  ): void => {
    recordInstanceWrite(scope, source);
    const plan = listMutationPlans?.get(source);
    if (plan !== undefined) {
      recordInstanceWrite(
        scope,
        kind === 'targeted'
          ? plan.targetedReason
          : kind === 'topology'
            ? plan.topologyReason
            : plan.structuralReason,
      );
    }
  };
  const journalTargetedMutation = (
    p: NodePath,
    plan: KeyedListMutationPlan,
    key: t.Expression,
  ): void => {
    if (!p.isExpression()) return;
    p.replaceWith(
      t.sequenceExpression([
        t.callExpression(
          t.memberExpression(
            t.identifier(plan.keysVariable),
            t.identifier('add'),
          ),
          [key],
        ),
        p.node,
      ]),
    );
    p.skip();
  };

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
  const executionSites = new Map<
    t.Node,
    { path: NodePath; writes: ScopeWrites; flag?: t.Identifier }
  >();
  const scopeOf = (p: NodePath): ScopeWrites => {
    const fn = p.getFunctionParent()?.node ?? ROOT;
    let s = scopes.get(fn);
    if (!s) {
      scopes.set(fn, (s = createScopeWrites()));
    }
    return s;
  };
  const mutateScope = (
    p: NodePath,
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
  const noteSourceWrite = (p: NodePath): void => {
    mutateScope(p, (scope) => {
      if (rowCtx?.sourceLocal) {
        scope.rowOwnerLocal = true;
      } else if (rowCtx !== undefined) {
        scope.writes.add(rowCtx.sourceKey);
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
    p: NodePath,
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
    p: NodePath,
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
  const noteItemWrite = (p: NodePath, node: t.MemberExpression): boolean => {
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

  const noteOriginWrite = (p: NodePath, origin: ReactiveOrigin): void => {
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
        scope.writes.add(origin.root);
      });
      return;
    }
    if (origin.key !== null && origin.key.includes('.')) {
      mutateScope(p, (scope) => {
        scope.writes.add(origin.key!);
      });
    } else {
      // A dynamic store path is imprecise, but it is still bounded to the
      // store root. Prefix matching reaches every observer of that store.
      mutateScope(p, (scope) => {
        scope.writes.add(origin.root);
      });
    }
  };

  const noteReceiverEffect = (
    p: NodePath,
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
    if (origin.stateKind === 'computed') {
      throw p.buildCodeFrameError(
        `memo-dom: cannot mutate computed '${origin.root}' (R13) - write its SOURCE state instead`,
      );
    }
    mutateScope(p, (scope) => {
      scope.writes.add(origin.key ?? origin.root);
    });
  };

  const noteBoundedArguments = (
    p: NodePath,
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
      if (!t.isIdentifier(expression)) continue;
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

  const noteMemberWrite = (p: NodePath, node: t.MemberExpression): void => {
    const rootName = memberRootName(node);
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
        scope.writes.add(rootName);
        return;
      }
      const key = memberKey(node);
      if (key !== null && key.includes('.')) {
        scope.writes.add(key);
      } else {
        scope.writes.add(rootName);
      }
    });
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
        if (instDerived?.has(left.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot assign per-instance derivation '${left.name}' (R14) — write its source instead`,
          );
        }
        if (instVars?.has(left.name) === true) {
          mutateScope(p, (scope) => {
            recordInstanceMutation(scope, left.name);
          });
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
        mutateScope(p, (scope) => {
          scope.writes.add(left.name);
        });
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
        if (instDerived?.has(arg.name)) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update per-instance derivation '${arg.name}' (R14) — write its source instead`,
          );
        }
        if (instVars?.has(arg.name) === true) {
          mutateScope(p, (scope) => {
            recordInstanceMutation(scope, arg.name);
          });
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
        mutateScope(p, (scope) => {
          scope.writes.add(arg.name);
        });
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
                mutateScope(p, (scope) => {
                  for (const key of keys) scope.writes.add(key);
                });
              }
            } else {
              noteOriginWrite(p, target);
            }
          }
          return;
        }

        if (
          method !== null &&
          ARRAY_TOPOLOGY_METHODS.has(method) &&
          t.isIdentifier(callee.object) &&
          instVars?.has(callee.object.name) === true &&
          listMutationPlans?.has(callee.object.name) === true
        ) {
          const source = callee.object.name;
          mutateScope(p, (scope) => {
            recordInstanceMutation(scope, source, 'topology');
          });
          return;
        }

        const receiverRoot = t.isIdentifier(callee.object)
          ? callee.object.name
          : t.isMemberExpression(callee.object)
            ? memberRootName(callee.object)
            : null;
        if (
          receiverRoot !== null &&
          instDerived?.has(receiverRoot) &&
          !projectedProps.has(receiverRoot)
        ) {
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
        mutateScope(p, (scope) => {
          for (const w of sum.writes) scope.writes.add(w);
          for (const w of sum.boundedWrites) scope.writes.add(w);
          // Guard: in an effect callback's direct body (executionAwareRoot=true,
          // call is at the ROOT function scope), calling an unbounded external
          // function is CONSUMPTION — the same reasoning noteBoundedArguments
          // applies to reactive values passed as arguments. Without this guard,
          // any unbounded imported call (e.g. getEventLog()) sets rootFallback=true
          // which emits markDirtySubtree(rootId) into the effect body, causing
          // an infinite commit cascade (100-pass guard fires).
          const isEffectBodyDirectCall =
            executionAwareRoot && p.getFunctionParent()?.node === ROOT;
          if (sum.unbounded && !isEffectBodyDirectCall) {
            scope.rootFallback = true;
          }
        });
        for (const effect of sum.parameterWrites) {
          const argument = p.node.arguments[effect.index];
          if (argument === undefined || !t.isExpression(argument)) continue;
          const origin = aliases.resolveExpression(p.scope, argument);
          if (origin !== null) {
            if (isComputedOrigin(origin)) continue;
            noteReceiverEffect(p, extendOrigin(origin, effect.path));
          }
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

  const guardedRootSites: Array<{
    path: NodePath;
    writes: ScopeWrites;
    flag?: t.Identifier;
    commit: t.Statement;
  }> = [];
  if (executionAwareRoot) {
    for (const site of executionSites.values()) {
      const commit = buildScopeCommit(
        ctx,
        site.writes,
        compName,
        rowCtx,
      );
      if (commit !== null) {
        guardedRootSites.push({ ...site, commit });
      }
    }
  }

  for (const site of guardedRootSites) {
    site.flag = generatedIdentifier(ctx, 'didWrite');
  }

  // Instrument deepest expressions first so wrapping an outer expression
  // retains flags already inserted into its children.
  guardedRootSites
    .sort((a, b) => pathDepth(b.path) - pathDepth(a.path))
    .forEach((site) => markExecutionSite(site.path, site.flag!));

  // pass C: one commit per scope, appended inside the clone…
  for (const [fn, s] of scopes) {
    const commit =
      executionAwareRoot && fn === ROOT
        ? guardedRootSites.length === 0
          ? null
          : t.blockStatement(
              guardedRootSites.map((site) =>
                t.ifStatement(
                  t.cloneNode(site.flag!),
                  t.cloneNode(site.commit),
                ),
              ),
            )
        : buildScopeCommit(ctx, s, compName, rowCtx);
    if (!commit) continue;
    appendScopeCommit(
      ctx,
      fn as t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
      commit,
    );
  }

  if (guardedRootSites.length > 0) {
    if (!t.isBlockStatement(clonedFn.body)) {
      throw new Error(
        'memo-dom: execution-aware callback commit did not produce a block body',
      );
    }
    clonedFn.body.body.unshift(
      t.variableDeclaration('let', guardedRootSites.map((site) =>
        t.variableDeclarator(
          t.cloneNode(site.flag!),
          t.booleanLiteral(false),
        ),
      )),
    );
  }
  // …then adopt the mutated body (params are untouched)
  rootFn.body = clonedFn.body;
}

function pathDepth(path: NodePath): number {
  let depth = 0;
  let current: NodePath | null = path;
  while (current.parentPath !== null) {
    depth++;
    current = current.parentPath;
  }
  return depth;
}

function markExecutionSite(path: NodePath, flag: t.Identifier): void {
  const mark = t.assignmentExpression(
    '=',
    t.cloneNode(flag),
    t.booleanLiteral(true),
  );
  if (path.isVariableDeclarator()) {
    const init = path.node.init;
    if (init === null || !t.isExpression(init)) {
      throw new Error(
        'memo-dom: execution-aware variable site has no expression initializer',
      );
    }
    path.node.init = t.sequenceExpression([mark, init]);
    return;
  }
  if (!path.isExpression()) {
    throw new Error(
      `memo-dom: unsupported execution-aware write site '${path.node.type}'`,
    );
  }
  path.replaceWith(
    t.sequenceExpression([
      mark,
      path.node,
    ]),
  );
}

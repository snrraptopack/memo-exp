import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
  extractPatternIdentifiers,
  type BaseNode,
} from '../ast';
import {
  memberKey,
  memberRootName,
  type Ctx,
  type RowCtx,
} from '../context';
import { recordRoutedWrite } from '../handler-commits';
import {
  AliasTracker,
  bindingScopeIsProgram,
  extendOrigin,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from '../mutation-analysis';
import { summarizeHelper } from '../helper-summaries';
import { isStaticDerivedListConst } from '../lists/static-derived';
import {
  componentPropProjectionOrigins,
} from '../components/prop-projections';
import { transparentListExpression } from '../lists/source-shapes';
import {
  walkHandler,
} from './traversal';
import { finalizeHandlerInstrumentation } from './execution-sites';
import { createHandlerWriteRouting } from './write-routing';

function isLinkedImport(ctx: Ctx, name: string): boolean {
  return (
    ctx.importedState.has(name) ||
    ctx.importedValues.has(name) ||
    ctx.importedFunctions.has(name) ||
    ctx.importedComponents.has(name)
  );
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
  // Analysis runs on a deep parser-neutral clone. Commits are appended into
  // the clone's scopes and the mutated body is adopted wholesale at the end.
  const clonedFn = cloneNode(
    rootFn as unknown as BaseNode,
  ) as unknown as typeof rootFn;
  const ROOT: t.Node = clonedFn;
  const wrapper = clonedFn;

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
  const transparentRoots = compName === null
    ? new Set<string>()
    : (ctx.transparentSources.get(compName) ?? new Set<string>());
  const transparentRootFor = (expression: t.Expression): string | null => {
    const current = transparentListExpression(expression);
    if (astFactory.isIdentifier(current)) {
      return transparentRoots.has(current.name) ? current.name : null;
    }
    if (
      astFactory.isCallExpression(current) &&
      astFactory.isMemberExpression(current.callee) &&
      !current.callee.computed &&
      astFactory.isIdentifier(current.callee.object, {
        name: ctx.identifiers?.dataRuntimeId,
      }) &&
      astFactory.isIdentifier(current.callee.property, {
        name: 'readResolvedValue',
      }) &&
      astFactory.isIdentifier(current.arguments[0]) &&
      transparentRoots.has(current.arguments[0].name)
    ) {
      return current.arguments[0].name;
    }
    if (
      astFactory.isMemberExpression(current) ||
      astFactory.isOptionalMemberExpression(current)
    ) {
      return astFactory.isExpression(current.object)
        ? transparentRootFor(current.object)
        : null;
    }
    return null;
  };
  if (compName !== null) {
    for (const stmt of ctx.compPaths.get(compName)?.node.body.body ?? []) {
      if (astFactory.isVariableDeclaration(stmt)) {
        for (const d of stmt.declarations) {
          for (const { name } of extractPatternIdentifiers(
            d.id as unknown as BaseNode,
          )) {
            componentLocals.add(name);
          }
        }
      } else if (astFactory.isFunctionDeclaration(stmt) && stmt.id) {
        componentLocals.add(stmt.id.name);
      }
    }
  }

  const aliases = new AliasTracker((name, binding) => {
    if (rowCtx !== undefined && name === rowCtx.itemParam) {
      return { locality: 'row', root: name, key: name };
    }
    if (binding !== undefined && !bindingScopeIsProgram(binding)) return null;
    const projected = projectedProps.get(name);
    if (projected !== undefined) return projected;
    if (instVars?.has(name) === true) {
      return { locality: 'instance', root: name, key: name };
    }
    if (propNames.has(name)) {
      return { locality: 'prop', root: name, key: name };
    }
    if (componentLocals.has(name)) return null;
    const transparentKey = ctx.transparentModuleSources.get(name);
    if (transparentKey !== undefined) {
      return moduleOrigin(name, 'store');
    }
    const kind = ctx.state.get(name);
    return kind === undefined ? null : moduleOrigin(name, kind);
  });
  const {
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
  } = createHandlerWriteRouting({
    ctx,
    rootFn,
    clonedFn,
    root: ROOT,
    componentName: compName,
    rowContext: rowCtx,
    executionAwareRoot,
    aliases,
    instanceVariables: instVars,
    instanceDerivations: instDerived,
    projectedProps,
    propNames,
    componentLocals,
    transparentRootFor,
  });

  // R12: instance state of the enclosing component — writes are always a
  // bare markDirty(id), never table routing (the closure belongs to one
  // instance; listed components included).
  walkHandler(wrapper, {
    VariableDeclarator(p) {
      if (
        !astFactory.isIdentifier(p.node.id) &&
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
      if (astFactory.isIdentifier(left)) {
        if (locals.has(left.name)) {
          if (astFactory.isIdentifier(p.node.right)) {
            const origin = aliases.resolveExpression(p.scope, p.node.right);
            if (origin !== null) noteReceiverEffect(p, origin);
          }
          return;
        }
        if (
          isStaticDerivedListConst(ctx, left.name, compName)
        ) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign '${left.name}' - it is derived from a static source and will never change`,
          );
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
        if (
          p.scope.getBinding(left.name)?.kind === 'import' ||
          isLinkedImport(ctx, left.name)
        ) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot reassign imported state '${left.name}' - ES module imports are read-only; export a mutator instead`,
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
          recordRoutedWrite(
            scope,
            left.name,
            ctx.listSources.has(left.name),
          );
        });
      } else if (astFactory.isMemberExpression(left)) {
        noteMemberWrite(p, left);
      } else {
        for (const origin of aliases.referencedOrigins(p.scope, p.node.right)) {
          noteReceiverEffect(p, origin);
        }
      }
    },
    UpdateExpression(p) {
      const arg = p.node.argument;
      if (astFactory.isIdentifier(arg)) {
        if (locals.has(arg.name)) return;
        if (
          isStaticDerivedListConst(ctx, arg.name, compName)
        ) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update '${arg.name}' - it is derived from a static source and will never change`,
          );
        }
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
        if (
          p.scope.getBinding(arg.name)?.kind === 'import' ||
          isLinkedImport(ctx, arg.name)
        ) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot update imported state '${arg.name}' - ES module imports are read-only; call an exported mutator instead`,
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
          recordRoutedWrite(scope, arg.name);
        });
      } else if (astFactory.isMemberExpression(arg)) {
        noteMemberWrite(p, arg);
      }
    },
    UnaryExpression(p) {
      if (
        p.node.operator === 'delete' &&
        astFactory.isMemberExpression(p.node.argument)
      ) {
        noteMemberWrite(p, p.node.argument);
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;

      // A method call on a static-derived const is a mutation attempt on a
      // frozen value (push/splice/shift/...) - always an error.
      if (astFactory.isMemberExpression(callee)) {
        const receiverRoot = memberRootName(callee);
        if (
          receiverRoot !== null &&
          isStaticDerivedListConst(ctx, receiverRoot, compName)
        ) {
          throw p.buildCodeFrameError(
            `memo-dom: cannot mutate '${receiverRoot}' - it is derived from a static source and will never change`,
          );
        }
      }

      // Every method call on a reactive receiver has a bounded receiver
      // effect. No method-name purity/mutation table is consulted.
      if (astFactory.isMemberExpression(callee)) {
        const method = memberName(callee);
        if (
          method === 'assign' &&
          astFactory.isIdentifier(callee.object, { name: 'Object' })
        ) {
          const targetArg = p.node.arguments[0];
          const target =
            targetArg !== undefined && astFactory.isExpression(targetArg)
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
                  for (const key of keys) recordRoutedWrite(scope, key);
                });
              }
            } else {
              noteOriginWrite(p, target);
            }
          }
          return;
        }

        const receiverRoot = astFactory.isIdentifier(callee.object)
          ? callee.object.name
          : astFactory.isMemberExpression(callee.object)
            ? memberRootName(callee.object)
            : null;
        const transparentRoot = astFactory.isExpression(callee.object)
          ? transparentRootFor(callee.object)
          : null;
        if (transparentRoot !== null) {
          mutateScope(p, (scope) => scope.transparentWrites.add(transparentRoot));
          return;
        }
        if (
          eventBoundary &&
          p.getFunctionParent()?.node === ROOT &&
          receiverRoot !== null &&
          rootParamIndex.get(receiverRoot) === 0
        ) {
          // The first parameter of a host-event boundary is browser-owned.
          // Calling through that value (event.preventDefault(), a custom
          // event API, DataTransfer, and so on) cannot mutate application
          // state unless authored reactive values are passed separately.
          // This is provenance-based deliberately: event and method names
          // remain open-ended rather than living in a compiler allowlist.
          noteBoundedArguments(p, p.node.arguments);
          return;
        }
        if (
          receiverRoot !== null &&
          instDerived?.has(receiverRoot) &&
          !projectedProps.has(receiverRoot)
        ) {
          // Method bodies are opaque. The call may change observable state,
          // so invalidate the owner without declaring the invocation illegal.
          mutateScope(p, (scope) => {
            recordInstanceMutation(scope, receiverRoot);
          });
          return;
        }
        if (
          rowCtx === undefined &&
          receiverRoot !== null &&
          rootParamIndex.has(receiverRoot)
        ) {
          const key = astFactory.isMemberExpression(callee.object)
            ? memberKey(callee.object)
            : null;
          const relative = key !== null ? key.split('.').slice(1) : [];
          const recorded = ctx.localParamEffects.get(rootFn) ?? [];
          const entry = {
            index: rootParamIndex.get(receiverRoot)!,
            path: relative,
          };
          const signature = `${entry.index}:${entry.path.join('.')}`;
          if (
            !recorded.some(
              (existing) =>
                `${existing.index}:${existing.path.join('.')}` === signature,
            )
          ) {
            recorded.push(entry);
            ctx.localParamEffects.set(rootFn, recorded);
          }
          mutateScope(p, (scope) => {
            scope.rootFallback = true;
          });
          return;
        }
        const receiver =
          astFactory.isExpression(callee.object)
            ? aliases.resolveExpression(p.scope, callee.object)
            : null;
        if (receiver !== null) {
          noteReceiverEffect(p, receiver);
        } else {
          noteBoundedArguments(p, p.node.arguments);
        }
        return;
      }

      // calls to component-local helpers: fold parameter effects recorded
      // during the helper's own analysis through the call arguments. This is
      // what routes item-field mutations from hoisted helpers into the
      // caller's row scope — the helper body itself cannot reference row
      // identifiers, so without this fold the write would be invisible.
      if (
        astFactory.isIdentifier(callee) &&
        compName !== null &&
        componentLocals.has(callee.name)
      ) {
        // Resolve the helper through the component body, not the current
        // scope: analysis runs on a detached clone whose scope cannot see
        // component-level bindings.
        let helperFn: t.Node | null = null;
        for (const stmt of ctx.compPaths.get(compName)?.node.body.body ?? []) {
          if (
            astFactory.isFunctionDeclaration(stmt) &&
            stmt.id?.name === callee.name
          ) {
            helperFn = stmt;
            break;
          }
          if (astFactory.isVariableDeclaration(stmt)) {
            for (const d of stmt.declarations) {
              if (
                astFactory.isIdentifier(d.id) &&
                d.id.name === callee.name &&
                d.init !== null &&
                astFactory.isFunction(d.init)
              ) {
                helperFn = d.init;
                break;
              }
            }
            if (helperFn !== null) break;
          }
        }
        const parameterEffects = helperFn !== null ? ctx.localParamEffects.get(helperFn) : undefined;
        if (parameterEffects !== undefined) {
          for (const effect of parameterEffects) {
            const argument = p.node.arguments[effect.index];
            if (argument === undefined || !astFactory.isExpression(argument)) continue;
            const origin = aliases.resolveExpression(p.scope, argument);
            if (origin !== null) {
              if (isComputedOrigin(origin)) continue;
              noteReceiverEffect(p, extendOrigin(origin, effect.path));
              continue;
            }
            // Transitively propagate: an argument that is this function's own
            // parameter means the callee's effect composes with ours. Record
            // it under OUR node so an outer caller can keep folding up to
            // the scope that actually owns row identifiers.
            if (
              astFactory.isIdentifier(argument) &&
              rootParamIndex.has(argument.name)
            ) {
              const recorded = ctx.localParamEffects.get(rootFn) ?? [];
              const entry = {
                index: rootParamIndex.get(argument.name)!,
                path: effect.path,
              };
              const signature = `${entry.index}:${entry.path.join('.')}`;
              if (
                !recorded.some(
                  (existing) =>
                    `${existing.index}:${existing.path.join('.')}` ===
                    signature,
                )
              ) {
                recorded.push(entry);
                ctx.localParamEffects.set(rootFn, recorded);
              }
            }
          }
        }
      }

      // calls to module-level helpers: fold the callee's summary into this
      // scope (M5.3 — writes inside helpers used to vanish silently)
      if (
        astFactory.isIdentifier(callee) &&
        !componentLocals.has(callee.name) &&
        (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name))
      ) {
        const sum =
          ctx.importedFunctions.get(callee.name) ?? summarizeHelper(ctx, callee.name);
        mutateScope(p, (scope) => {
          for (const w of sum.writes) recordRoutedWrite(scope, w);
          for (const w of sum.boundedWrites) recordRoutedWrite(scope, w);
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
          if (argument === undefined || !astFactory.isExpression(argument)) continue;
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
  }, ctx.moduleId);

  finalizeHandlerInstrumentation(
    ctx,
    rootFn,
    clonedFn,
    ROOT,
    scopes,
    executionSites,
    compName,
    rowCtx,
    eventBoundary,
    eventOriginId,
    executionAwareRoot,
  );
}

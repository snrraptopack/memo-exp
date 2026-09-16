/**
 * Exact-source attribution for JSX slot expressions.
 *
 * A slot may skip re-evaluation on an update whose dirty reasons name none of
 * its sources. That is only sound when every reactive read in the expression
 * is a source the owner's handlers report exactly (instance state, props, or
 * derivations rooted in them). Anything else — module state, transparent
 * sources, opaque locals, unsummarized calls, mutations — returns null and the
 * slot stays unconditional, exactly as before.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { BaseNode } from '../ast';
import { astBindingAt, astScopeAt, walkNodes, type Ctx } from '../context';
import { summarizeHelper } from '../helper-summaries';

/** Root sources read by `expression`, or null when not exactly attributable. */
export function slotReasonSources(
  ctx: Ctx,
  component: string,
  expression: t.Expression,
): string[] | null {
  const instance = ctx.instanceState.get(component);
  const props = ctx.componentProps.get(component)?.bindings;
  const derivedRoots = derivationRoots(ctx, component);
  const transparent = ctx.transparentSources.get(component);
  const opaque = ctx.opaqueBindings.get(component);

  const roots = new Set<string>();
  let exact = true;
  const bail = (): false => {
    exact = false;
    return false;
  };

  walkNodes(expression, (node, parent) => {
    if (!exact) return false;
    switch (node.type) {
      case 'AssignmentExpression':
      case 'UpdateExpression':
      case 'AwaitExpression':
      case 'YieldExpression':
      case 'NewExpression':
      case 'TaggedTemplateExpression':
      case 'JSXElement':
      case 'JSXFragment':
        return bail();
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const callee = (node as t.CallExpression).callee;
        if (astFactory.isIdentifier(callee) && !calleeIsPure(ctx, callee)) {
          return bail();
        }
        return undefined;
      }
      case 'Identifier': {
        if (!isValueReference(node as t.Identifier, parent)) return undefined;
        const name = (node as t.Identifier).name;
        if (
          transparent?.has(name) === true ||
          opaque?.has(name) === true ||
          ctx.state.has(name)
        ) {
          return bail();
        }
        const upstream = derivedRoots.get(name);
        if (upstream !== undefined) {
          if (upstream === null) return bail();
          for (const root of upstream) roots.add(root);
        } else if (instance?.has(name) === true || props?.includes(name) === true) {
          roots.add(name);
        }
        return undefined;
      }
      default:
        return undefined;
    }
  });
  return exact ? [...roots].sort() : null;
}

/**
 * Derived binding → its root sources (already resolved transitively by
 * finalizeInstancePreludes). Stable-target derivations (transparent fetch
 * handles) map to null: their value changes outside the reason channel.
 */
function derivationRoots(
  ctx: Ctx,
  component: string,
): Map<string, readonly string[] | null> {
  const map = new Map<string, readonly string[] | null>();
  for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
    for (const binding of derivation.bindings) {
      map.set(binding, derivation.stableTarget === true ? null : derivation.sources);
    }
  }
  for (const control of ctx.instanceControlFlow.get(component) ?? []) {
    for (const binding of control.bindings) map.set(binding, control.sources);
  }
  return map;
}

/** Identifier positions that read a value (not property keys or labels). */
function isValueReference(node: t.Identifier, parent: t.Node | null): boolean {
  if (parent === null) return true;
  if (
    (astFactory.isMemberExpression(parent) ||
      astFactory.isOptionalMemberExpression(parent)) &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    astFactory.isObjectProperty(parent) &&
    parent.key === node &&
    !parent.computed
  ) {
    return false;
  }
  return true;
}

/**
 * A callee is pure for gating purposes when it is a summarized helper with
 * no reads or effects, or a global with no lexical binding at all (String,
 * Math.*, …). Component-local closures and unindexed nodes are not.
 */
function calleeIsPure(ctx: Ctx, callee: t.Identifier): boolean {
  const name = callee.name;
  const summary =
    ctx.importedFunctions.get(name) ??
    (ctx.helpers.has(name) ? summarizeHelper(ctx, name) : undefined);
  if (summary !== undefined) {
    return (
      summary.reads.size === 0 &&
      summary.writes.size === 0 &&
      summary.boundedWrites.size === 0 &&
      summary.parameterWrites.length === 0 &&
      !summary.unbounded
    );
  }
  const node = callee as unknown as BaseNode;
  if (astScopeAt(ctx, node) === undefined) return false;
  return astBindingAt(ctx, node, name) === undefined;
}

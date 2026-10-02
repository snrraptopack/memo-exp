/** Finalize exact expression-source inputs before a backend mutates factories. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { BaseNode } from '../ast';
import { astBindingAt, astScopeAt, walkNodes, type Ctx } from '../context';
import { summarizeHelper } from '../helper-summaries';
import { createExpressionSourceFacts, type ComponentExpressionSources } from '../analysis/expression-sources';

export function planExpressionSources(ctx: Ctx): ReadonlyMap<string, ComponentExpressionSources> {
  const result = new Map<string, ComponentExpressionSources>();
  // Resolve only helpers used by a component, sharing summaries across owners.
  const helpers = new Map<string, boolean>();
  for (const [component, path] of ctx.compPaths) {
    const globals = new WeakSet<t.Node>();
    walkNodes(path.node, node => {
      if (!astFactory.isCallExpression(node) && !astFactory.isOptionalCallExpression(node)) return;
      let root = node.callee;
      while (astFactory.isMemberExpression(root) || astFactory.isOptionalMemberExpression(root)) {
        if (astFactory.isSuper(root.object)) break;
        root = root.object;
      }
      if (astFactory.isIdentifier(root)) {
        const source = root as unknown as BaseNode;
        if (astScopeAt(ctx, source) !== undefined && astBindingAt(ctx, source, root.name) === undefined) {
          globals.add(root);
        }
      }
      if (!astFactory.isIdentifier(node.callee) || helpers.has(node.callee.name)) return;
      const name = node.callee.name;
      const summary = ctx.importedFunctions.get(name) ??
        (ctx.helpers.has(name) ? summarizeHelper(ctx, name) : undefined);
      if (summary !== undefined) helpers.set(name,
        summary.reads.size === 0 && summary.opaqueReads !== true && summary.writes.size === 0 &&
        summary.boundedWrites.size === 0 && summary.parameterWrites.length === 0 && !summary.unbounded);
    });
    // These sources have already been resolved transitively by prelude analysis.
    // Stable fetch handles may change outside the exact write channel.
    const derived = new Map<string, readonly string[] | null>();
    for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
      for (const binding of derivation.bindings) derived.set(binding,
        derivation.stableTarget === true ? null : derivation.sources);
    }
    for (const control of ctx.instanceControlFlow.get(component) ?? []) {
      for (const binding of control.bindings) derived.set(binding, control.sources);
    }
    const helperFacts = new Map(helpers);
    result.set(component, createExpressionSourceFacts({
      ownerSources: new Set([
        ...(ctx.instanceState.get(component) ?? []),
        ...(ctx.componentProps.get(component)?.bindings ?? []),
      ]),
      unknownSources: new Set([
        ...ctx.state.keys(),
        ...(ctx.transparentSources.get(component)?.keys() ?? []),
        ...(ctx.opaqueBindings.get(component) ?? []),
      ]),
      derivedSources: derived,
      pureCallee: callee => {
        if (astFactory.isIdentifier(callee)) {
          const pure = helperFacts.get(callee.name);
          if (pure !== undefined) return pure;
        }
        let root = callee;
        while (astFactory.isMemberExpression(root) || astFactory.isOptionalMemberExpression(root)) {
          if (astFactory.isSuper(root.object)) return false;
          root = root.object;
        }
        // Cloned/unindexed globals remain conservative, as before. Name alone
        // does not prove lexical identity or the absence of a hidden read.
        return astFactory.isIdentifier(root) && globals.has(root);
      },
    }));
  }
  return result;
}

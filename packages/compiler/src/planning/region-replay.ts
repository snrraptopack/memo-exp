/** Capture structural replay inputs before a backend consumes source factories. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst } from '../ast';
import { astBindingAt, type Ctx } from '../context';
import { matchMapCall } from '../lists';
import { transparentListExpression } from '../lists/source-shapes';
import { createRegionReplayFacts, type ComponentRegionReplay } from '../analysis/region-replay';

export function planRegionReplays(ctx: Ctx): ReadonlyMap<string, ComponentRegionReplay> {
  const plans = new Map<string, ComponentRegionReplay>();
  for (const [name, path] of ctx.compPaths) {
    const fixedSources = new WeakMap<t.Node, string>();
    walkAst<t.Node>(path.node, { enter(node) {
      const call = matchMapCall(node);
      if (call === null) return;
      const callee = call.callee as t.MemberExpression | t.OptionalMemberExpression;
      if (!astFactory.isExpression(callee.object)) return;
      const source = transparentListExpression(callee.object);
      if (!astFactory.isIdentifier(source)) return;
      const binding = astBindingAt(ctx, call, source.name);
      if (binding !== undefined && ctx.plainListItemTargets.has(binding.identifier)) {
        fixedSources.set(call, source.name);
      }
    }});
    plans.set(name, createRegionReplayFacts({
      ownerRoots: new Set([
        ...(ctx.instanceState.get(name) ?? []),
        ...(ctx.instanceDerivedBindings.get(name) ?? []),
        ...(ctx.componentProps.get(name)?.bindings ?? []),
      ]),
      volatile: ctx.volatileComponents.has(name),
      moduleIndexSources: new Set(ctx.moduleListTargets.keys()),
      stateKeys: ctx.stateKeys,
      fixedSourceFor: call => fixedSources.get(call),
    }));
  }
  return plans;
}

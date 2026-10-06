/** Capture structural replay inputs before a backend consumes source factories. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst } from '../ast';
import { astBindingAt, type Ctx } from '../context';
import { matchMapCall } from '../lists';
import { transparentListExpression } from '../lists/source-shapes';
import { createRegionReplayFacts, type ComponentRegionReplay, type OwnerListReplay } from '../analysis/region-replay';

export function planRegionReplays(ctx: Ctx): ReadonlyMap<string, ComponentRegionReplay> {
  const plans = new Map<string, ComponentRegionReplay>();
  for (const [name, path] of ctx.compPaths) {
    const fixedSources = new WeakMap<t.Node, string>();
    const ownerStructures = new WeakMap<t.Node, OwnerListReplay>();
    walkAst<t.Node>(path.node, { enter(node) {
      const call = matchMapCall(node);
      if (call === null) return;
      const structuralSource = ctx.ownerListStructureSources.get(call);
      const structuralReasonKey = structuralSource === undefined ? undefined :
        ctx.ownerListStructureReasonKeys.get(name)?.get(structuralSource) ?? structuralSource;
      const structuralReason = structuralReasonKey === undefined ? undefined : ctx.instanceReasonIds.get(name)?.get(structuralReasonKey);
      if (structuralSource !== undefined && structuralReason !== undefined) {
        ownerStructures.set(call, { source: structuralSource, reason: structuralReason,
          guarded: ctx.ownerListGuards.get(name)?.has(structuralSource) });
      }
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
      ownerStructureFor: call => ownerStructures.get(call),
    }));
  }
  return plans;
}

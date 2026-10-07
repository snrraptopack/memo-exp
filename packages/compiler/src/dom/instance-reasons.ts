import type { DomContext as Ctx } from './context';

/** Deterministic ABI indices are allocated only after source analysis is complete. */
export function allocateInstanceReasons(ctx:Ctx):void {
  ctx.instanceReasonIds.clear();
  for(const [component,sources] of ctx.instanceReasonSources) {
    ctx.instanceReasonIds.set(component,new Map([...sources].sort().map((source,index)=>[source,index])));
  }
}

/** Both ordinary and proven structural writes invalidate a source reader. */
export function instanceSourceReasons(ctx: Ctx, component: string, source: string): number[] | null {
  const ids = ctx.instanceReasonIds.get(component);
  const ordinary = ids?.get(source);
  if (ordinary === undefined) return null;
  const structuralKey = ctx.ownerListStructureReasonKeys.get(component)?.get(source);
  const structural = structuralKey === undefined ? undefined : ids?.get(structuralKey);
  return structural === undefined ? [ordinary] : [ordinary, structural];
}

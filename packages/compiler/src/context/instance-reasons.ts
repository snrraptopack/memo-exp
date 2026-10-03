import type { Ctx } from './model';

/** Both ordinary and proven structural writes invalidate a source reader. */
export function instanceSourceReasons(ctx: Ctx, component: string, source: string): number[] | null {
  const ids = ctx.instanceReasonIds.get(component);
  const ordinary = ids?.get(source);
  if (ordinary === undefined) return null;
  const structuralKey = ctx.ownerListStructureReasonKeys.get(component)?.get(source);
  const structural = structuralKey === undefined ? undefined : ids?.get(structuralKey);
  return structural === undefined ? [ordinary] : [ordinary, structural];
}

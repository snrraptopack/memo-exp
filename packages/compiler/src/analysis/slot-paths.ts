import type { Ctx } from '../context';

function sourceComponentName(segment: string): string {
  const repeated = segment.indexOf('[');
  return repeated < 0 ? segment : segment.slice(0, repeated);
}

/**
 * Add the runtime identity alternatives created by deferred render slots.
 *
 * The first mount deliberately retains the lexical path. Later live mounts
 * insert `$slot[n]` immediately below the component that authored the slot.
 * Expanding static access paths here keeps state routing precise without
 * runtime JSX values or dynamic dependency registration.
 */
export function expandRenderSlotPaths(
  ctx: Ctx,
  paths: readonly string[],
): string[] {
  const expanded = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    let variants: string[][] = [[]];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      const next = variants.map((variant) => [...variant, segment]);
      if (
        index < segments.length - 1 &&
        ctx.renderSlotOwners.has(sourceComponentName(segment))
      ) {
        for (const variant of variants) {
          next.push([...variant, segment, '$slot[*]']);
        }
      }
      variants = next;
    }
    for (const variant of variants) expanded.add(variant.join('/'));
  }
  return [...expanded];
}

import type { Ctx } from '../context';

/** Follow module projections back to library-owned subscription roots. */
export function externalSourceRoots(ctx: Ctx, reads: Iterable<string>): string[] {
  const sources = new Set<string>();
  const visited = new Set<string>();
  const note = (source: string): void => {
    const root = source.split('.')[0]!;
    if (visited.has(root)) return;
    visited.add(root);
    if (ctx.externalReactiveBindings.has(root)) sources.add(root);
    for (const dependency of ctx.computeds.get(root)?.reads ?? []) note(dependency);
    for (const control of ctx.moduleControlFlow) {
      if (control.bindings.includes(root)) {
        for (const dependency of control.sources) note(dependency);
      }
    }
  };
  for (const read of reads) note(read);
  return [...sources].sort();
}

/** Module calculations outlive any one component and belong to the application. */
export function moduleExternalSources(ctx: Ctx): string[] {
  const reads = new Set<string>();
  for (const computed of ctx.computeds.values()) {
    for (const source of computed.reads) reads.add(source);
  }
  for (const control of ctx.moduleControlFlow) {
    for (const source of control.sources) reads.add(source);
  }
  for (const effect of ctx.moduleEffects) {
    for (const source of effect.moduleReads) reads.add(source);
    for (const source of effect.conditionModuleReads) reads.add(source);
  }
  return externalSourceRoots(ctx, reads);
}

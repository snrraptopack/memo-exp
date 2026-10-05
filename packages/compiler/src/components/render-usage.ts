/** Authored caller evidence shared by local and linked prop contracts. */
export interface ComponentPropUsage {
  target: string;
  prop: string;
  kind: 'jsx' | 'scalar';
  forwardedFrom?: { target: string; prop: string };
}

export interface RenderUsage {
  jsx: Set<string>;
  scalar: Set<string>;
}

export function resolveRenderUsage(usages: readonly ComponentPropUsage[]): Map<string, RenderUsage> {
  const result = new Map<string, RenderUsage>();
  function add(target: string, prop: string, kind: ComponentPropUsage['kind']): boolean {
    let usage = result.get(target);
    if (!usage) { usage = { jsx: new Set(), scalar: new Set() }; result.set(target, usage); }
    if (usage[kind].has(prop)) return false;
    usage[kind].add(prop);
    return true;
  }
  for (const usage of usages) if (!usage.forwardedFrom) add(usage.target, usage.prop, usage.kind);
  // Parameter forwarding alone proves neither contract. Propagate positive
  // caller evidence until even cyclic wrapper graphs reach a fixed point.
  const forwards = usages.filter(usage => usage.forwardedFrom);
  let changed = true;
  while (changed) {
    changed = false;
    for (const usage of forwards) {
      const source = result.get(usage.forwardedFrom!.target);
      if (!source) continue;
      for (const kind of ['jsx', 'scalar'] as const) {
        if (source[kind].has(usage.forwardedFrom!.prop)) {
          changed = add(usage.target, usage.prop, kind) || changed;
        }
      }
    }
  }
  return result;
}

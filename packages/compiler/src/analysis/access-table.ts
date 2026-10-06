import { canonicalStateKey, type Ctx } from '../context';
import { componentPatterns, pathVariants, isLightweightRowComponent } from './component-graph';
import { expandRenderSlotPaths } from './slot-paths';

// Compiler/runtime protocol. This key is internal access-table metadata, not
// an authored state path; ordinary state writes cannot match the NUL suffix.
const LIST_STRUCTURE_READER_SUFFIX = '\0memo-dom:list-structure-reader';

export type AccessReaderPlan = ReadonlyMap<string, ReadonlySet<string>>;

/** Capture canonical reader routes without constructing backend statements. */
export function planAccessReaders(ctx: Ctx): AccessReaderPlan {
  const table = new Map<string, Set<string>>();
  const canonicalListSources = new Set(
    [...ctx.listSources].map((source) => canonicalStateKey(ctx, source)),
  );
  const componentOwnsListSource = (
    component: string,
    variable: string,
  ): boolean => {
    const source = canonicalStateKey(ctx, variable);
    for (const candidate of ctx.componentListSources.get(component) ?? []) {
      if (canonicalStateKey(ctx, candidate) === source) return true;
    }
    return false;
  };
  const add = (
    variable: string,
    patterns: readonly string[],
    structuralPatterns: readonly string[] = patterns,
  ): void => {
    const key = canonicalStateKey(ctx, variable);
    let readers = table.get(key);
    if (!readers) table.set(key, (readers = new Set()));
    for (const pattern of patterns) readers.add(pattern);
    if (!canonicalListSources.has(key)) return;
    const structuralKey = `${key}${LIST_STRUCTURE_READER_SUFFIX}`;
    let structuralReaders = table.get(structuralKey);
    if (!structuralReaders) {
      table.set(structuralKey, (structuralReaders = new Set()));
    }
    for (const pattern of structuralPatterns) structuralReaders.add(pattern);
  };

  for (const [component, variables] of ctx.compReads) {
    if (variables.size === 0) continue;
    const patterns = componentPatterns(ctx, component);
    const ownerPatterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, component),
    );
    for (const variable of variables) {
      const excluded = new Set<string>();
      for (const site of ctx.moduleListSelectionSites) {
        if (site.rowComponent !== component || !site.values.includes(variable)) continue;
        if (isLightweightRowComponent(ctx, component) &&
            (ctx.listedSites.get(component) ?? []).some(placement => placement.owner === site.owner &&
              !ctx.moduleListSelectionSites.some(proven => proven.owner === placement.owner &&
                proven.suffix === placement.suffix && proven.rowComponent === component && proven.values.includes(variable)))) continue;
        const rowPatterns = pathVariants(ctx, site.owner).map(owner =>
          isLightweightRowComponent(ctx, component) ? owner : `${owner}/${site.suffix}/Row[*]`);
        for (const pattern of expandRenderSlotPaths(ctx, rowPatterns)) excluded.add(pattern);
      }
      add(
        variable,
        patterns.filter(pattern => !excluded.has(pattern)),
        componentOwnsListSource(component, variable) ? ownerPatterns : patterns,
      );
    }
  }
  for (const site of ctx.moduleListSelectionSites) {
    const patterns = expandRenderSlotPaths(ctx, pathVariants(ctx, site.owner).map(owner =>
      `${owner}/${site.suffix}/$selection`));
    for (const value of site.values) add(value, patterns);
  }
  for (const { owner, suffix, vars } of ctx.rowReads.values()) {
    const patterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, owner).flatMap((variant) => [
        `${variant}/${suffix}/Row[*]`,
      ]),
    );
    for (const variable of vars) add(variable, patterns);
  }
  for (const { owner, suffix, vars } of ctx.condReads.values()) {
    const patterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, owner).flatMap((variant) => [
        `${variant}/${suffix}`,
      ]),
    );
    for (const variable of vars) add(variable, patterns);
  }
  for (const [component, sites] of ctx.effects) {
    const ownerPatterns = componentPatterns(ctx, component);
    for (const site of sites) {
      const basePatterns = ownerPatterns.map(
        (pattern) => `${pattern}/$effects/${site.index}`,
      );
      const callbackPatterns =
        site.condition === null
          ? basePatterns
          : basePatterns.map((pattern) => `${pattern}/$active`);
      for (const read of site.moduleReads) add(read, callbackPatterns);
      for (const read of site.conditionModuleReads) add(read, basePatterns);
    }
  }
  for (const site of ctx.moduleEffects) {
    const callbackId =
      site.condition === null ? site.entityId : `${site.entityId}/$active`;
    for (const read of site.moduleReads) add(read, [callbackId]);
    for (const read of site.conditionModuleReads) {
      add(read, [site.entityId]);
    }
  }
  for (const [name, info] of ctx.computeds) {
    const entityId =
      `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#${name}`;
    for (const key of info.reads) add(key, [entityId]);
  }
  for (const flow of ctx.moduleControlFlow) {
    for (const key of flow.sources) add(key, [flow.entityId]);
  }

  return table;
}

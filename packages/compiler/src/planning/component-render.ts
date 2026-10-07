/** Target-independent component return structure, completed before emission. */
import type { ComponentListSites } from './list-sites';
import type { ComponentPath } from '../context';
import { analyzeComponentReturns, type ComponentReturns } from '../components/return-plan';
import type { ComponentExpressionSources } from '../analysis/expression-sources';
import type { ComponentPullPlan } from '../analysis/primitive-pull';
import type { ComponentPlacement } from './component-placement';
import type { ComponentRegionReplay } from '../analysis/region-replay';
import { planComponentRegionShapes, type ComponentRegionShapes } from './region-shapes';

export interface PlannedComponent {
  readonly name: string;
  readonly source: ComponentPath;
  readonly returns: ComponentReturns;
  readonly expressionSources: ComponentExpressionSources;
  readonly pullPlan: ComponentPullPlan | null;
  readonly placement: ComponentPlacement;
  readonly regionReplay: ComponentRegionReplay;
  readonly regionShapes: ComponentRegionShapes;
  readonly listSites: ComponentListSites;
}

export interface ModuleRenderPlan {
  readonly components: readonly PlannedComponent[];
}

export interface ComponentRenderInputs {
  readonly expressionSources: ReadonlyMap<string, ComponentExpressionSources>;
  readonly pullPlans: ReadonlyMap<string, ComponentPullPlan>;
  readonly placements: ReadonlyMap<string, ComponentPlacement>;
  readonly regionReplays: ReadonlyMap<string, ComponentRegionReplay>;
  readonly listSites: ReadonlyMap<string, ComponentListSites>;
  readonly renderCallbackProps: ReadonlyMap<string, readonly string[]>;
}

/**
 * Plan every component before a backend can replace any component factory.
 * The plan owns return structure; AST references belong to this compilation
 * and are consumed by emission. Planning allocates no DOM operations, ABI or
 * runtime identifiers. Semantic planning supplies exact sources, authored primitive
 * writes, component placement and structural replay. Callback/branch syntax is
 * planned here; captured list source/target/key inputs supply semantic queries.
 * Region identity allocation and factory ABI retain their backend adapters.
 */
export function planComponentRendering(
  components: ReadonlyMap<string, ComponentPath>,
  inputs: ComponentRenderInputs,
): ModuleRenderPlan {
  return {
    components: [...components].map(([name, source]) => {
      const sources = inputs.expressionSources.get(name);
      if (sources === undefined) throw new Error(`memo-dom: missing expression-source plan for '${name}'`);
      const placement = inputs.placements.get(name);
      if (placement === undefined) throw new Error(`memo-dom: missing placement plan for '${name}'`);
      const regionReplay = inputs.regionReplays.get(name);
      if (regionReplay === undefined) throw new Error(`memo-dom: missing region-replay plan for '${name}'`);
      const listSites = inputs.listSites.get(name);
      if (listSites === undefined) throw new Error(`memo-dom: missing list-site plan for '${name}'`);
      return { name, source, returns: analyzeComponentReturns(source, name), expressionSources: sources,
        pullPlan: inputs.pullPlans.get(name) ?? null, placement, regionReplay,
        regionShapes: planComponentRegionShapes(source, inputs.renderCallbackProps), listSites };
    }),
  };
}

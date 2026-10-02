/** Target-independent component return structure, completed before emission. */
import type { ComponentPath } from '../context';
import { analyzeComponentReturns, type ComponentReturns } from '../components/return-plan';
import type { ComponentExpressionSources } from '../analysis/expression-sources';
import type { ComponentPullPlan } from '../analysis/primitive-pull';
import type { ComponentPlacement } from './component-placement';

export interface PlannedComponent {
  readonly name: string;
  readonly source: ComponentPath;
  readonly returns: ComponentReturns;
  readonly expressionSources: ComponentExpressionSources;
  readonly pullPlan: ComponentPullPlan | null;
  readonly placement: ComponentPlacement;
}

export interface ModuleRenderPlan {
  readonly components: readonly PlannedComponent[];
}

/**
 * Plan every component before a backend can replace any component factory.
 * The plan owns return structure; AST references belong to this compilation
 * and are consumed by emission. It carries no DOM operations, ABI or runtime
 * identifiers. Semantic planning supplies exact sources, authored primitive
 * writes and component placement; region/ABI decisions still live in emission.
 */
export function planComponentRendering(
  components: ReadonlyMap<string, ComponentPath>,
  expressionSources: ReadonlyMap<string, ComponentExpressionSources>,
  pullPlans: ReadonlyMap<string, ComponentPullPlan>,
  placements: ReadonlyMap<string, ComponentPlacement>,
): ModuleRenderPlan {
  return {
    components: [...components].map(([name, source]) => {
      const sources = expressionSources.get(name);
      if (sources === undefined) throw new Error(`memo-dom: missing expression-source plan for '${name}'`);
      const placement = placements.get(name);
      if (placement === undefined) throw new Error(`memo-dom: missing placement plan for '${name}'`);
      return { name, source, returns: analyzeComponentReturns(source, name), expressionSources: sources,
        pullPlan: pullPlans.get(name) ?? null, placement };
    }),
  };
}

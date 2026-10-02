/** Target-independent component return structure, completed before emission. */
import type { ComponentPath } from '../context';
import { analyzeComponentReturns, type ComponentReturns } from '../components/return-plan';
import type { ComponentExpressionSources } from '../analysis/expression-sources';

export interface PlannedComponent {
  readonly name: string;
  readonly source: ComponentPath;
  readonly returns: ComponentReturns;
  readonly expressionSources: ComponentExpressionSources;
}

export interface ModuleRenderPlan {
  readonly components: readonly PlannedComponent[];
}

/**
 * Plan every component before a backend can replace any component factory.
 * The plan owns return structure; AST references belong to this compilation
 * and are consumed by emission. It carries no DOM operations, ABI or runtime
 * identifiers. Exact expression sources are supplied by semantic planning;
 * other provenance/ownership facts still live in Ctx for now.
 */
export function planComponentRendering(
  components: ReadonlyMap<string, ComponentPath>,
  expressionSources: ReadonlyMap<string, ComponentExpressionSources>,
): ModuleRenderPlan {
  return {
    components: [...components].map(([name, source]) => {
      const sources = expressionSources.get(name);
      if (sources === undefined) throw new Error(`memo-dom: missing expression-source plan for '${name}'`);
      return { name, source, returns: analyzeComponentReturns(source, name), expressionSources: sources };
    }),
  };
}

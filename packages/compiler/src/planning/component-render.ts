/** Target-independent component return structure, completed before emission. */
import type { ComponentPath } from '../context';
import { analyzeComponentReturns, type ComponentReturns } from '../components/return-plan';

export interface PlannedComponent {
  readonly name: string;
  readonly source: ComponentPath;
  readonly returns: ComponentReturns;
}

export interface ModuleRenderPlan {
  readonly components: readonly PlannedComponent[];
}

/**
 * Plan every component before a backend can replace any component factory.
 * The plan owns return structure; AST references belong to this compilation
 * and are consumed by emission. It carries no DOM operations, ABI or runtime
 * identifiers. Shared expression/ownership facts still live in Ctx for now.
 */
export function planComponentRendering(
  components: ReadonlyMap<string, ComponentPath>,
): ModuleRenderPlan {
  return {
    components: [...components].map(([name, source]) => ({
      name,
      source,
      returns: analyzeComponentReturns(source, name),
    })),
  };
}

/**
 * Invalidates every Vite module backed by one linked compiler graph.
 */
import type {
  DevEnvironment,
  EnvironmentModuleNode,
} from 'vite';
import type { AdapterState } from './state';

export function invalidateManagedGraph(
  environment: DevEnvironment,
  state: AdapterState,
  timestamp: number,
): EnvironmentModuleNode[] {
  const invalidated = new Set<EnvironmentModuleNode>();
  for (const file of state.files) {
    const modules = environment.moduleGraph.getModulesByFile(file);
    if (modules === undefined) continue;
    for (const module of modules) {
      environment.moduleGraph.invalidateModule(
        module,
        invalidated,
        timestamp,
        true,
      );
    }
  }
  state.invalidate();
  return [...invalidated];
}

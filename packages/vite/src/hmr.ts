/**
 * Invalidates only linked modules whose generated output changed.
 */
import type {
  DevEnvironment,
  EnvironmentModuleNode,
} from 'vite';
export function invalidateManagedModules(
  environment: DevEnvironment,
  files: ReadonlySet<string>,
  timestamp: number,
): EnvironmentModuleNode[] {
  const invalidated = new Set<EnvironmentModuleNode>();
  for (const file of files) {
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
  return [...invalidated];
}

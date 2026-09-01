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
  const direct = new Set<EnvironmentModuleNode>();
  const seen = new Set<EnvironmentModuleNode>();
  for (const file of files) {
    const modules = environment.moduleGraph.getModulesByFile(file);
    if (modules === undefined) continue;
    for (const module of modules) {
      direct.add(module);
      environment.moduleGraph.invalidateModule(
        module,
        seen,
        timestamp,
        true,
      );
    }
  }
  return [...direct];
}

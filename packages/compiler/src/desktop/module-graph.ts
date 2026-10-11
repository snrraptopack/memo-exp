/** Link and emit a desktop source graph using shared project facts. */
import { localRenderProps } from '../linking/render-props';
import { linkImports } from '../linking/resolution';
import { linkDesktopProject } from './project';
import { compileDesktop, type DesktopCompileOptions, type DesktopCompiledSource } from './compile';

export interface DesktopModuleGraph {
  readonly modules: ReadonlyMap<string, DesktopCompiledSource>;
}

/**
 * Discovery precedes emission. State-only modules and barrels participate in
 * the same fixed-point helper summaries as JSX modules, regardless of which
 * import the bundler happens to load first.
 */
export function compileDesktopGraph(
  source: string,
  options: DesktopCompileOptions,
): DesktopModuleGraph {
  const { entries, manifests, linkOptions, renderUsage } = linkDesktopProject(source, options);
  const modules = new Map<string, DesktopCompiledSource>();
  for (const entry of entries.values()) {
    modules.set(
      entry.id,
      compileDesktop(entry.source, {
        ...options,
        allowComponentFree: true,
        moduleId: entry.id,
        linkedImports: linkImports(
          entry,
          manifests.get(entry.id)!,
          manifests,
          entries,
          linkOptions,
        ),
        linkedComponentRenderProps: localRenderProps(manifests.get(entry.id)!, renderUsage),
        activationModules: [...entries.keys()],
        readStylesheet: options.readStylesheet
          ? (specifier) => options.readStylesheet!(specifier, entry.originalId)
          : undefined,
      }),
    );
  }
  return { modules };
}

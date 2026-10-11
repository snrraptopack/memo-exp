/** Scene linking selects its analysis profile over the shared source graph. */
import { memoizedEstreeFrontend } from '../ast';
import { collectProject, discoverProject } from '../linking/project';
import { linkManifestWorklist } from '../linking/graph';
import { desktopManifestAnalysis } from './pipeline';
import type { DesktopCompileOptions } from './compile';

export function linkDesktopProject(source: string, options: DesktopCompileOptions) {
  const frontend = options.frontend ?? memoizedEstreeFrontend;
  const { entries, resolveImport } = collectProject(
    source,
    options.moduleId ?? './desktop.tsx',
    frontend,
    options.readModule,
  );
  const linkOptions = {
    frontend,
    runtimePath: '@memoized-dom/runtime',
    externalReactiveSources: options.externalReactiveSources,
    resolveImport,
  };
  const discovered = discoverProject(entries, linkOptions);
  const manifests = linkManifestWorklist(
    entries,
    discovered,
    linkOptions,
    'Desktop',
    [],
    desktopManifestAnalysis,
  );
  return { entries, manifests, linkOptions };
}

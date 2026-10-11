/** Scene linking selects its analysis profile over the shared source graph. */
import { memoizedEstreeFrontend } from '../ast';
import { collectProject, discoverProject } from '../linking/project';
import { linkManifestWorklist } from '../linking/graph';
import { resolveProjectRenderUsage, refineRenderProps } from '../linking/render-props';
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
  const renderUsage = resolveProjectRenderUsage(manifests);
  // Apply the same caller evidence to import contracts and callee emission.
  // Discovery's provisional exported candidates are not final prop semantics.
  // This closed native graph emits structural slots only with positive caller
  // evidence. Unobserved untyped exports retain their existing scalar behavior.
  for (const manifest of manifests.values()) {
    for (const exported of Object.values(manifest.exports)) {
      if (exported.type === 'component') {
        exported.renderProps = refineRenderProps(
          exported.key,
          exported.renderProps,
          renderUsage,
        ).filter((prop) => renderUsage.get(exported.key)?.jsx.has(prop) === true);
      }
    }
  }
  return { entries, manifests, linkOptions, renderUsage };
}

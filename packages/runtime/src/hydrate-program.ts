/** General adoption uses the same payload handoff as fixed initial bindings. */
import { installHydrationRuntime } from './mount';
import { hydrateApplicationRoot, type HydrationCapabilities } from './hydration';
import { HydrationMismatchError } from './hydration-error';
import { initializePayload } from './payload';
import { rootNodes } from './jsx-dom';
import { createApplication, createMountedApplication } from './mount-core';

export function installProgramHydration(capabilities: HydrationCapabilities): void {
  const shared = installHydrationRuntime((host, definition, serverRootId, options) => {
    try {
      if (serverRootId !== definition.id) {
        throw new HydrationMismatchError(
          definition.id,
          `<!--mmd:r:${definition.id}-->`,
          `<!--mmd:r:${serverRootId}-->`,
        );
      }
      return initializePayload(host, definition, () => {
        const adopted = hydrateApplicationRoot(host, definition, shared);
        const mounted = createMountedApplication(
          host, definition, rootNodes(adopted.root), adopted.disposeMarkers,
        );
        for (const error of adopted.recovered) options.onHydrateError?.(error, 'region');
        return mounted;
      }, error => error instanceof HydrationMismatchError);
    } catch (error) {
      if (!(error instanceof HydrationMismatchError)) throw error;
      options.onHydrateError?.(error, 'root');
      host.innerHTML = '';
      return createApplication(host, definition);
    }
  }, capabilities);
}

export { hydrateList } from './hydration-list';
export { hydrateMarkup } from './hydration-markup';

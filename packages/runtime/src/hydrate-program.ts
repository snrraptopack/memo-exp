/** General adoption uses the same payload handoff as fixed initial bindings. */
import { installHydrationRuntime } from './mount';
import { hydrateApplicationRoot, type HydrationCapabilities } from './hydration';
import { HydrationMismatchError } from './hydration-error';
import { initializePayload } from './payload';

export function installProgramHydration(capabilities: HydrationCapabilities): void {
  const shared = installHydrationRuntime((host, definition, adopt) => initializePayload(
    host, definition, () => adopt(hydrateApplicationRoot(host, definition, shared)),
    error => error instanceof HydrationMismatchError,
  ), capabilities);
}

export { hydrateList } from './hydration-list';
export { hydrateMarkup } from './hydration-markup';

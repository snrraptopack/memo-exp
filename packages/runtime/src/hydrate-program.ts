/** Shared payload restoration and adoption, with compiler-selected capabilities. */

import {
  installHydrationRuntime,
  type MountedApplication,
  type RootFactoryDefinition,
} from './mount';
import {
  hydrateApplicationRoot,
  type HydratedApplicationRoot,
  type HydrationCapabilities,
} from './hydration';
import { HydrationMismatchError } from './hydration-error';
import { getExtensionStore, unregisterSubtree } from './kernel';

interface HydrationPayloadDelivery {
  readonly version: 1;
  readonly state?: unknown;
  readonly routed?: unknown;
}

interface DataRuntimeBridge {
  restoreState?(state: unknown): void;
  completeHydration?(): void;
  cancelHydration?(): void;
  pendingState?: unknown;
}

interface RouterRuntimeBridge {
  restoreState?(state: unknown): void;
  pendingState?: unknown;
}

const routerRuntimeBridgeKey = Symbol.for(
  'memoized-dom:router-runtime-bridge',
);

function routerRuntimeBridge(): RouterRuntimeBridge {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[routerRuntimeBridgeKey];
  if (typeof existing === 'object' && existing !== null) {
    return existing as RouterRuntimeBridge;
  }
  const created: RouterRuntimeBridge = {};
  realm[routerRuntimeBridgeKey] = created;
  return created;
}

/**
 * Server markup can carry an `application/mmd+json` script with dehydrated
 * data-source and router state. Restore it before adoption claims any nodes.
 */
function restorePayload(
  rootId: string,
  host: Element,
): { script?: Element; data: DataRuntimeBridge } {
  const document = host.ownerDocument;
  const data = getExtensionStore<DataRuntimeBridge>(
    'mmd:data-runtime-active',
    () => ({}),
  );
  const script = [...document.querySelectorAll(
    'script[type="application/mmd+json"][data-mmd-root]',
  )].find(candidate => candidate.getAttribute('data-mmd-root') === rootId);
  if (!script?.textContent) return { data };
  let parsed: unknown;
  try {
    parsed = JSON.parse(script.textContent);
  } catch {
    return { script, data };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return { script, data };
  }
  const payload = parsed as HydrationPayloadDelivery;
  if (payload.state !== undefined) {
    if (data.restoreState !== undefined) {
      try {
        data.restoreState(payload.state);
      } catch {
        // A malformed or incompatible data envelope must not prevent the
        // application from mounting. Its sources can fetch normally.
      }
    } else {
      // Preserve an early payload until the optional data package registers its
      // default runtime. Browser bootstrap never has to install one manually.
      data.pendingState = payload.state;
    }
  }
  if (payload.routed !== undefined) {
    const router = routerRuntimeBridge();
    if (router.restoreState !== undefined) {
      router.restoreState(payload.routed);
    } else {
      router.pendingState = payload.routed;
    }
  }
  return { script, data };
}

function hydrateWithPayload(
  host: Element,
  definition: RootFactoryDefinition,
  adopt: (adopted: HydratedApplicationRoot) => MountedApplication,
  capabilities: HydrationCapabilities,
): MountedApplication {
  const restoration = restorePayload(definition.id, host);
  let adopted: HydratedApplicationRoot;
  try {
    adopted = hydrateApplicationRoot(host, definition, capabilities);
  } catch (error) {
    unregisterSubtree(definition.id);
    if (error instanceof HydrationMismatchError) {
      restoration.data.completeHydration?.();
    } else {
      restoration.data.cancelHydration?.();
    }
    restoration.script?.remove();
    throw error;
  }
  const mounted = adopt(adopted);
  restoration.data.completeHydration?.();
  restoration.script?.remove();
  return mounted;
}

export function installProgramHydration(capabilities: HydrationCapabilities): void {
  const shared = installHydrationRuntime((host, definition, adopt) => hydrateWithPayload(host, definition, adopt, shared), capabilities);
}

export { hydrateList } from './hydration-list';
export { hydrateMarkup } from './hydration-markup';

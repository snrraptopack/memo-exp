/** General mount detects SSR; its installed capability owns adoption/recovery. */
import type { HydrationCapabilities } from './hydration';
import { parseRootHydrationIdentity } from './hydration-marker';
import {
  resolveMount, createApplication,
  type MountTarget, type MountableComponent, type MountOptions,
  type RootFactoryDefinition, type MountedApplication,
} from './mount-core';
export {
  registerRootFactory, rootFactoryStore, mountStore, removeNodes, resolveHost,
} from './mount-core';
export type {
  MountTarget, MountableComponent, MountOptions, RootMountContext,
  RootFactoryDefinition, MountedApplication, MountStore,
} from './mount-core';

interface HydrationRuntimeBridge {
  capabilities?: HydrationCapabilities;
  hydrate?(
    host: Element,
    definition: RootFactoryDefinition,
    serverRootId: string,
    options: MountOptions,
  ): MountedApplication;
}

const hydrationRuntimeBridgeKey = Symbol.for(
  'memoized-dom:hydration-runtime-bridge',
);

function hydrationRuntimeBridge(): HydrationRuntimeBridge {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[hydrationRuntimeBridgeKey];
  if (typeof existing === 'object' && existing !== null) {
    return existing as HydrationRuntimeBridge;
  }
  const created: HydrationRuntimeBridge = {};
  realm[hydrationRuntimeBridgeKey] = created;
  return created;
}

/**
 * Installed by the optional '@memoized-dom/runtime/hydrate' entry. Keeping
 * the adoption machinery behind this bridge keeps HydrationDocument out of
 * browser bundles that only ever perform fresh client mounts.
 */
export function installHydrationRuntime(
  hydrate: NonNullable<HydrationRuntimeBridge['hydrate']>,
  capabilities: HydrationCapabilities = {},
): HydrationCapabilities {
  const bridge = hydrationRuntimeBridge();
  // Independently bundled roots may share this realm. Later narrow programs
  // must not discard capabilities an earlier root still needs for adoption.
  const shared = bridge.capabilities ??= {};
  Object.assign(shared, capabilities);
  bridge.hydrate = hydrate;
  return shared;
}

function hydrationRootId(host: Element): string | null {
  for (let node = host.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    const identity = parseRootHydrationIdentity((node as Comment).data);
    if (identity !== null) return identity;
  }
  return null;
}

/**
 * Mount one compiled application root. A matching SSR root is adopted
 * automatically; a structural mismatch is discarded and mounted once.
 */
export function mount(
  target: MountTarget,
  component: MountableComponent,
  options: MountOptions = {},
): MountedApplication {
  const { host, definition } = resolveMount(target, component);
  const serverRootId = hydrationRootId(host);
  if (serverRootId === null) {
    return createApplication(host, definition);
  }
  const hydrate = hydrationRuntimeBridge().hydrate;
  if (hydrate === undefined) {
    console.warn(
      "memoized-dom: server markup found but the hydration runtime is not installed; add `import '@memoized-dom/runtime/hydrate'` to the client entry to adopt it. Falling back to a fresh client mount.",
    );
    host.innerHTML = '';
    return createApplication(host, definition);
  }
  return hydrate(host, definition, serverRootId, options);
}

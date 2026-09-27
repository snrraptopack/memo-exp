import {
  getActiveEnvironment,
  getExtensionStore,
  unregisterSubtree,
} from './kernel';
import { rootNodes } from './jsx-dom';
import { HydrationMismatchError } from './hydration-error';
import type { HydratedApplicationRoot } from './hydration';
import { parseHydrationMarker } from './hydration-marker';

/** Authored zero-argument component reference accepted by the browser entry. */
export type MountableComponent = () => unknown;
export type MountTarget = string | Element;

export interface MountOptions {
  /** Called before a hydration mismatch is recovered with a fresh client mount. */
  onHydrateError?: (error: HydrationMismatchError) => void;
}

export interface RootMountContext {
  readonly mode: 'create' | 'hydrate';
  readonly host: Element;
}

export interface RootFactoryDefinition {
  id: string;
  create(context: RootMountContext): Node;
}

export interface MountedApplication {
  readonly host: Element;
  readonly rootId: string;
  readonly nodes: readonly Node[];
  readonly mounted: boolean;
  unmount(): void;
}

interface HydrationRuntimeBridge {
  hydrate?(
    host: Element,
    definition: RootFactoryDefinition,
    adopt: (adopted: HydratedApplicationRoot) => MountedApplication,
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
): void {
  hydrationRuntimeBridge().hydrate = hydrate;
}

// Factory definitions are build artifacts — process-wide by nature.
const rootFactoriesKey = Symbol.for('memoized-dom:root-factories');

export function rootFactoryStore(): WeakMap<Function, RootFactoryDefinition> {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[rootFactoriesKey];
  if (existing instanceof WeakMap) {
    return existing as WeakMap<Function, RootFactoryDefinition>;
  }
  const created = new WeakMap<Function, RootFactoryDefinition>();
  realm[rootFactoriesKey] = created;
  return created;
}

// Mount bookkeeping is per application runtime: two concurrent server
// requests may each mount the same compiled root into their own documents.
export interface MountStore {
  readonly mountedHosts: WeakMap<Element, MountedApplication>;
  readonly mountedRoots: Map<string, MountedApplication>;
}
export function mountStore(): MountStore {
  return getExtensionStore('mount', () => ({
    mountedHosts: new WeakMap<Element, MountedApplication>(),
    mountedRoots: new Map<string, MountedApplication>(),
  }));
}

/** Compiler-emitted root metadata. Application code should call mount(). */
export function registerRootFactory(
  component: Function,
  definition: RootFactoryDefinition,
): void {
  rootFactoryStore().set(component, definition);
}

export function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

export function resolveHost(target: MountTarget): Element {
  if (typeof target !== 'string') return target;
  const host = getActiveEnvironment().document.getElementById(target);
  if (host === null) {
    throw new Error(`memoized-dom: mount target '#${target}' was not found`);
  }
  return host;
}

function validateMount(
  host: Element,
  definition: RootFactoryDefinition,
): MountStore {
  const store = mountStore();
  if (store.mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  if (store.mountedRoots.has(definition.id)) {
    throw new Error(
      `memoized-dom: root entity '${definition.id}' is already mounted`,
    );
  }
  if (store.mountedRoots.size > 0) {
    throw new Error(
      'memoized-dom: the runtime currently supports one mounted application',
    );
  }
  return store;
}

function createMountedApplication(
  host: Element,
  definition: RootFactoryDefinition,
  nodes: readonly Node[],
  disposeMarkers?: () => void,
): MountedApplication {
  const store = mountStore();
  let live = true;
  const application: MountedApplication = {
    host,
    rootId: definition.id,
    nodes,
    get mounted() {
      return live;
    },
    unmount() {
      if (!live) return;
      live = false;
      store.mountedHosts.delete(host);
      store.mountedRoots.delete(definition.id);
      try {
        unregisterSubtree(definition.id);
      } finally {
        removeNodes(nodes);
        disposeMarkers?.();
      }
    },
  };
  store.mountedHosts.set(host, application);
  store.mountedRoots.set(definition.id, application);
  return application;
}

function createApplication(
  host: Element,
  definition: RootFactoryDefinition,
): MountedApplication {

  let root: Node;
  try {
    root = definition.create({ mode: 'create', host });
  } catch (error) {
    unregisterSubtree(definition.id);
    throw error;
  }
  const nodes = rootNodes(root);
  try {
    host.appendChild(root);
  } catch (error) {
    unregisterSubtree(definition.id);
    removeNodes(nodes);
    throw error;
  }

  return createMountedApplication(host, definition, nodes);
}

function hydrationRootId(host: Element): string | null {
  for (let node = host.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    const marker = parseHydrationMarker((node as Comment).data);
    if (
      marker?.type === 'open' &&
      marker.kind === 'r'
    ) return marker.identity;
  }
  return null;
}

function adoptApplication(
  host: Element,
  definition: RootFactoryDefinition,
  hydrate: NonNullable<HydrationRuntimeBridge['hydrate']>,
): MountedApplication {
  return hydrate(host, definition, adopted =>
    createMountedApplication(
      host,
      definition,
      rootNodes(adopted.root),
      adopted.disposeMarkers,
    ),
  );
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
  const host = resolveHost(target);
  const definition = rootFactoryStore().get(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: mount received a component that is not a compiled application root',
    );
  }
  validateMount(host, definition);
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
  try {
    if (serverRootId !== definition.id) {
      throw new HydrationMismatchError(
        definition.id,
        `<!--mmd:r:${definition.id}-->`,
        `<!--mmd:r:${serverRootId}-->`,
      );
    }
    return adoptApplication(host, definition, hydrate);
  } catch (error) {
    if (!(error instanceof HydrationMismatchError)) throw error;
    options.onHydrateError?.(error);
    host.innerHTML = '';
    return createApplication(host, definition);
  }
}

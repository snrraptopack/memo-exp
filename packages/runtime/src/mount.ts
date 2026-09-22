import {
  getActiveEnvironment,
  getExtensionStore,
  runWithRenderEnvironment,
  unregisterSubtree,
} from './kernel';
import { rootNodes } from './jsx-dom';
import {
  createHydrationCursor,
  HydrationDocument,
  HydrationMismatchError,
  parseHydrationMarker,
} from './hydration';

/** Authored zero-argument component reference accepted by the browser entry. */
export type MountableComponent = () => unknown;
export type MountTarget = string | Element;

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

interface HydrationPayloadDelivery {
  readonly version: 1;
  readonly state?: unknown;
  readonly routed?: unknown;
}

interface DataRuntimeBridge {
  restoreState?(state: unknown): void;
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

function hasHydrationRoot(host: Element, rootId: string): boolean {
  for (let node = host.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    const marker = parseHydrationMarker((node as Comment).data);
    if (
      marker?.type === 'open' &&
      marker.kind === 'r' &&
      marker.identity === rootId
    ) return true;
  }
  return false;
}

function restorePayload(rootId: string, host: Element): void {
  const document = host.ownerDocument;
  const script = document.querySelector(
    `script[type="application/mmd+json"][data-mmd-root="${rootId}"]`,
  );
  if (!script?.textContent) return;
  let payload: HydrationPayloadDelivery;
  try {
    payload = JSON.parse(script.textContent) as HydrationPayloadDelivery;
  } catch {
    return;
  }
  if (payload.state !== undefined) {
    const data = getExtensionStore<DataRuntimeBridge>(
      'mmd:data-runtime-active',
      () => ({}),
    );
    if (data.restoreState !== undefined) {
      data.restoreState(payload.state);
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
}

function adoptApplication(
  host: Element,
  definition: RootFactoryDefinition,
): MountedApplication {
  restorePayload(definition.id, host);
  const range = createHydrationCursor(host, definition.id);
  const hydrationDocument = new HydrationDocument(
    getActiveEnvironment().document,
    range,
  );
  let root: Node;
  try {
    root = runWithRenderEnvironment(
      {
        mode: 'hydrate',
        document: hydrationDocument,
        hydration: hydrationDocument,
      },
      () => definition.create({ mode: 'hydrate', host }),
    );
    hydrationDocument.expectDone();
  } catch (error) {
    unregisterSubtree(definition.id);
    throw error;
  } finally {
    hydrationDocument.finishHydration();
  }
  return createMountedApplication(
    host,
    definition,
    rootNodes(root),
    () => {
      range.open.parentNode?.removeChild(range.open);
      range.end.parentNode?.removeChild(range.end);
    },
  );
}

/**
 * Mount one compiled application root. A matching SSR root is adopted
 * automatically; a structural mismatch is discarded and mounted once.
 */
export function mount(
  target: MountTarget,
  component: MountableComponent,
): MountedApplication {
  const host = resolveHost(target);
  const definition = rootFactoryStore().get(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: mount received a component that is not a compiled application root',
    );
  }
  validateMount(host, definition);
  if (!hasHydrationRoot(host, definition.id)) {
    return createApplication(host, definition);
  }
  try {
    return adoptApplication(host, definition);
  } catch (error) {
    if (!(error instanceof HydrationMismatchError)) throw error;
    host.innerHTML = '';
    return createApplication(host, definition);
  }
}

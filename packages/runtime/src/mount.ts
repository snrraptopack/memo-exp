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

function restorePayload(
  rootId: string,
  host: Element,
): { script?: Element; data: DataRuntimeBridge } | undefined {
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

function adoptApplication(
  host: Element,
  definition: RootFactoryDefinition,
): MountedApplication {
  const restoration = restorePayload(definition.id, host);
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
    if (error instanceof HydrationMismatchError) {
      restoration?.data?.completeHydration?.();
    } else {
      restoration?.data?.cancelHydration?.();
    }
    restoration?.script?.remove();
    throw error;
  } finally {
    hydrationDocument.finishHydration();
  }
  const mounted = createMountedApplication(
    host,
    definition,
    rootNodes(root),
    () => {
      range.open.parentNode?.removeChild(range.open);
      range.end.parentNode?.removeChild(range.end);
    },
  );
  restoration?.data?.completeHydration?.();
  restoration?.script?.remove();
  return mounted;
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
  try {
    if (serverRootId !== definition.id) {
      throw new HydrationMismatchError(
        definition.id,
        `<!--mmd:r:${definition.id}-->`,
        `<!--mmd:r:${serverRootId}-->`,
      );
    }
    return adoptApplication(host, definition);
  } catch (error) {
    if (!(error instanceof HydrationMismatchError)) throw error;
    options.onHydrateError?.(error);
    host.innerHTML = '';
    return createApplication(host, definition);
  }
}

import {
  getActiveEnvironment,
  getExtensionStore,
  runWithRenderEnvironment,
  unregisterSubtree,
} from './kernel';
import {
  createHydrationCursor,
  HydrationDocument,
  HydrationMismatchError,
} from './hydration';
import { rootNodes } from './jsx-dom';

/** Authored zero-argument component reference accepted by the browser entry. */
export type MountableComponent = () => unknown;
export type MountTarget = string | Element;

export interface RootMountContext {
  readonly mode: 'create' | 'hydrate';
  readonly host: Element;
}

interface RootFactoryDefinition {
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

// Factory definitions are build artifacts — process-wide by nature.
const rootFactories = new WeakMap<Function, RootFactoryDefinition>();

// Mount bookkeeping is per application runtime: two concurrent server
// requests may each mount the same compiled root into their own documents.
interface MountStore {
  readonly mountedHosts: WeakMap<Element, MountedApplication>;
  readonly mountedRoots: Map<string, MountedApplication>;
}
function mountStore(): MountStore {
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
  rootFactories.set(component, definition);
}

function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

function resolveHost(target: MountTarget): Element {
  if (typeof target !== 'string') return target;
  const host = getActiveEnvironment().document.getElementById(target);
  if (host === null) {
    throw new Error(`memoized-dom: mount target '#${target}' was not found`);
  }
  return host;
}

export interface MountOptions {
  /**
   * Optional hydration options. If provided (or true), `mount` operates in
   * hydration mode and adopts existing server DOM nodes.
   */
  hydration?: boolean | HydrateOptions;
}

/** Mount one compiled application root into an ordinary DOM host. */
export function mount(
  target: MountTarget,
  component: MountableComponent,
  options?: MountOptions,
): MountedApplication {
  if (options?.hydration) {
    const hydrateOpts = typeof options.hydration === 'object' ? options.hydration : {};
    return hydrate(target, component, hydrateOpts);
  }
  const host = resolveHost(target);
  if (mountStore().mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  const definition = rootFactories.get(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: mount received a component that is not a compiled application root',
    );
  }
  if (mountStore().mountedRoots.has(definition.id)) {
    throw new Error(
      `memoized-dom: root entity '${definition.id}' is already mounted`,
    );
  }
  if (mountStore().mountedRoots.size > 0) {
    throw new Error(
      'memoized-dom: the runtime currently supports one mounted application',
    );
  }

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
      mountStore().mountedHosts.delete(host);
      mountStore().mountedRoots.delete(definition.id);
      try {
        unregisterSubtree(definition.id);
      } finally {
        removeNodes(nodes);
      }
    },
  };
  mountStore().mountedHosts.set(host, application);
  mountStore().mountedRoots.set(definition.id, application);
  return application;
}
export interface HydrationPayloadDelivery {
  readonly version: 1;
  readonly state?: unknown;
}

export interface HydrateOptions {
  /**
   * Mismatch recovery policy:
   * - 'strict' (default): throw HydrationMismatchError on structural or tag skew.
   * - 'recover': on regional/root mismatch, cleanly unregister and fall back to
   *   client creation for the mismatched scope (or the root if unbounded).
   */
  recover?: boolean;
  /** Callback notified whenever a hydration mismatch is recovered. */
  onRecover?: (error: HydrationMismatchError) => void;
  /**
   * Transport configuration for the DOM-embedded JSON state payload:
   * - 'auto' (default): queries `<script type="application/mmd+json" data-mmd-root="...">`
   * - explicit payload object
   * - 'none': ignores embedded payload
   */
  payload?: 'auto' | 'none' | HydrationPayloadDelivery;
}
/**
 * Adopt server-rendered DOM nodes within the application root boundary.
 * In strict mode (default) any structural skew throws HydrationMismatchError.
 * In recover mode (recover: true), a root-level structural mismatch clears
 * the host container and seamlessly falls back to clean client mounting.
 */
export function hydrate(
  target: MountTarget,
  component: MountableComponent,
  options: HydrateOptions = {},
): MountedApplication {
  const host = resolveHost(target);
  if (mountStore().mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  const definition = rootFactories.get(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: hydrate received a component that is not a compiled application root',
    );
  }
  if (
    mountStore().mountedRoots.has(definition.id) ||
    mountStore().mountedRoots.size > 0
  ) {
    throw new Error(
      `memoized-dom: root entity '${definition.id}' is already mounted`,
    );
  }


  // Locate and restore DOM-embedded state payload channel (RFC §16.6)
  if (options.payload !== 'none') {
    let rawPayload: unknown = typeof options.payload === 'object' ? options.payload : undefined;
    let channelScript: Element | null = null;
    if (rawPayload === undefined && typeof globalThis.document !== 'undefined') {
      channelScript = globalThis.document.querySelector(
        `script[type="application/mmd+json"][data-mmd-root="${definition.id}"]`,
      );
      if (channelScript?.textContent) {
        try {
          rawPayload = JSON.parse(channelScript.textContent);
        } catch {
          // Corrupt JSON payload ignored; client falls back to fresh acquire
        }
      }
    }
    if (
      rawPayload &&
      typeof rawPayload === 'object' &&
      'state' in rawPayload &&
      rawPayload.state !== undefined
    ) {
      const activeData = getExtensionStore<{ restoreState?(s: unknown): void }>('mmd:data-runtime-active', () => ({}));
      activeData.restoreState?.(rawPayload.state);
    }
  }
  const range = createHydrationCursor(host, definition.id);
  const hydrationDoc = new HydrationDocument(
    getActiveEnvironment().document,
    range,
  );
  let root: Node;
  try {
    root = runWithRenderEnvironment(
      { mode: 'hydrate', document: hydrationDoc, hydration: hydrationDoc },
      () => definition.create({ mode: 'hydrate', host }),
    );
    hydrationDoc.expectDone();
  } catch (error) {
    unregisterSubtree(definition.id);
    if (options.recover && error instanceof HydrationMismatchError) {
      options.onRecover?.(error);
      // Clean up server markup from the host
      host.innerHTML = '';
      return mount(target, component);
    }
    throw error;
  }

  const nodes = rootNodes(root);
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
      mountStore().mountedHosts.delete(host);
      mountStore().mountedRoots.delete(definition.id);
      try {
        unregisterSubtree(definition.id);
      } finally {
        removeNodes(nodes);
        range.open.parentNode?.removeChild(range.open);
        range.end.parentNode?.removeChild(range.end);
      }
    },
  };
  mountStore().mountedHosts.set(host, application);
  mountStore().mountedRoots.set(definition.id, application);
  return application;
}

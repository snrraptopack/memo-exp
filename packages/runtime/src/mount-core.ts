/** Shared root ownership for browser creation, initial HTML and hydration. */
import {
  getActiveEnvironment, getActiveApplicationRuntime, getExtensionStore,
  runInApplicationRuntime, unregisterSubtree,
} from './kernel';
import { rootNodes } from './jsx-dom';
import type { HydrationMismatchError } from './hydration-error';

/** Authored zero-argument component reference accepted by the browser entry. */
export type MountableComponent = () => unknown;
export type MountTarget = string | Element;
export interface MountOptions {
  /**
   * Called for each hydration mismatch. `region`: one data region rendered
   * itself on the client and the rest of the root kept its server DOM.
   * `root`: called before the whole root is replaced by a fresh client mount.
   */
  onHydrateError?: (error: HydrationMismatchError, scope: 'region' | 'root') => void;
}
export interface RootMountContext {
  readonly mode: 'create' | 'hydrate';
  readonly host: Element;
}
export interface RootFactoryDefinition {
  id: string;
  create(context: RootMountContext): Node;
  /** Server-only build contract. Never needed by a browser binding factory. */
  readonly initialDelivery?: {
    readonly key: string;
    readonly html?: string;
    readonly target: string;
    readonly browser: 'none' | 'bindings';
  };
}
export interface MountedApplication {
  readonly host: Element;
  readonly rootId: string;
  readonly nodes: readonly Node[];
  readonly mounted: boolean;
  unmount(): void;
}

// Factory definitions are build artifacts shared across request runtimes.
const rootFactoriesKey = Symbol.for('memoized-dom:root-factories');
export function rootFactoryStore(): WeakMap<Function, RootFactoryDefinition> {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[rootFactoriesKey];
  if (existing instanceof WeakMap) return existing as WeakMap<Function, RootFactoryDefinition>;
  const created = new WeakMap<Function, RootFactoryDefinition>();
  realm[rootFactoriesKey] = created;
  return created;
}

export interface MountStore {
  readonly mountedHosts: WeakMap<Element, MountedApplication>;
  readonly mountedRoots: Map<string, MountedApplication>;
}
// Bookkeeping is per application runtime; factories are shared build artifacts.
export function mountStore(): MountStore {
  return getExtensionStore('mount', () => ({
    mountedHosts: new WeakMap<Element, MountedApplication>(),
    mountedRoots: new Map<string, MountedApplication>(),
  }));
}

/** Compiler-emitted metadata. Authored entries continue to call mount(). */
export function registerRootFactory(component: Function, definition: RootFactoryDefinition): void {
  rootFactoryStore().set(component, definition);
}
export function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}
export function resolveHost(target: MountTarget): Element {
  if (typeof target !== 'string') return target;
  const host = getActiveEnvironment().document.getElementById(target);
  if (host === null) throw new Error(`memoized-dom: mount target '#${target}' was not found`);
  return host;
}

/** Resolve and validate before creation or adoption changes any DOM. */
export function resolveMount(target: MountTarget, component: MountableComponent) {
  const host = resolveHost(target);
  const definition = rootFactoryStore().get(component);
  if (definition === undefined) {
    throw new Error('memoized-dom: mount received a component that is not a compiled application root');
  }
  const store = mountStore();
  if (store.mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  if (store.mountedRoots.has(definition.id)) {
    throw new Error(`memoized-dom: root entity '${definition.id}' is already mounted`);
  }
  if (store.mountedRoots.size > 0) {
    throw new Error('memoized-dom: the runtime currently supports one mounted application');
  }
  return { host, definition };
}

export function createMountedApplication(
  host: Element,
  definition: RootFactoryDefinition,
  nodes: readonly Node[],
  disposeMarkers?: () => void,
): MountedApplication {
  const store = mountStore();
  const runtime = getActiveApplicationRuntime();
  let live = true;
  const application: MountedApplication = {
    host, rootId: definition.id, nodes,
    get mounted() { return live; },
    unmount() {
      if (!live) return;
      live = false;
      store.mountedHosts.delete(host);
      store.mountedRoots.delete(definition.id);
      // Handles may outlive the request or component call that created them.
      runInApplicationRuntime(runtime, () => {
        try { unregisterSubtree(definition.id); }
        finally { removeNodes(nodes); disposeMarkers?.(); }
      });
    },
  };
  store.mountedHosts.set(host, application);
  store.mountedRoots.set(definition.id, application);
  return application;
}

export function createApplication(host: Element, definition: RootFactoryDefinition): MountedApplication {
  let root: Node;
  try { root = definition.create({ mode: 'create', host }); }
  catch (error) { unregisterSubtree(definition.id); throw error; }
  const nodes = rootNodes(root);
  try { host.appendChild(root); }
  catch (error) { unregisterSubtree(definition.id); removeNodes(nodes); throw error; }
  return createMountedApplication(host, definition, nodes);
}

/** Compiler-only operation for a build-proven initial-HTML entry. */
export function mountInitial(
  target: MountTarget, component: MountableComponent,
  initialize?: (host: Element, definition: RootFactoryDefinition, create: () => MountedApplication) => MountedApplication,
): MountedApplication {
  const { host, definition } = resolveMount(target, component);
  return initialize ? initialize(host, definition, () => createApplication(host, definition))
    : createApplication(host, definition);
}

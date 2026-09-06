import {
  getActiveEnvironment,
  getExtensionStore,
  unregisterSubtree,
} from './kernel';
import { rootNodes } from './jsx-dom';

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

// Factory definitions are build artifacts — process-wide by nature.
const rootFactoriesKey = Symbol.for('memoized-dom:root-factories');

function rootFactoryStore(): WeakMap<Function, RootFactoryDefinition> {
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

/** Mount one compiled application root into an ordinary DOM host. */
export function mount(
  target: MountTarget,
  component: MountableComponent,
): MountedApplication {
  const host = resolveHost(target);
  if (mountStore().mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  const definition = rootFactoryStore().get(component);
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

/** Hydration entry support; intentionally absent from the public client barrel. */
export function rootFactoryFor(
  component: MountableComponent,
): RootFactoryDefinition | undefined {
  return rootFactoryStore().get(component);
}

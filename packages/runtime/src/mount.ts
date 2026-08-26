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

/** Mount one compiled application root into an ordinary DOM host. */
export function mount(
  target: MountTarget,
  component: MountableComponent,
): MountedApplication {
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

/**
 * Adopt one marker-wrapped static host root without recreating its element or
 * text nodes. This first integration increment deliberately rejects
 * structural ranges/fragments; cond/list/row adoption follows separately.
 */
export function hydrate(
  target: MountTarget,
  component: MountableComponent,
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

  const range = createHydrationCursor(host, definition.id);
  const document = new HydrationDocument(
    getActiveEnvironment().document,
    range,
  );
  let root: Node;
  try {
    root = runWithRenderEnvironment(
      { mode: 'hydrate', document, hydration: document },
      () => definition.create({ mode: 'hydrate', host }),
    );
    document.expectDone();
    if (root.nodeType === 11) {
      throw new HydrationMismatchError(
        definition.id,
        'one static host root',
        'a document fragment root',
      );
    }
  } catch (error) {
    unregisterSubtree(definition.id);
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

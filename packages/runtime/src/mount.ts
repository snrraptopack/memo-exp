import { unregisterSubtree } from './kernel';
import { rootNodes } from './jsx-dom';

/** Authored zero-argument component reference accepted by the browser entry. */
export type MountableComponent = () => unknown;
export type MountTarget = string | Element;

export interface RootMountContext {
  readonly mode: 'create';
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

const rootFactories = new WeakMap<Function, RootFactoryDefinition>();
const mountedHosts = new WeakMap<Element, MountedApplication>();
const mountedRoots = new Map<string, MountedApplication>();

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
  const host = document.getElementById(target);
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
  if (mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  const definition = rootFactories.get(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: mount received a component that is not a compiled application root',
    );
  }
  if (mountedRoots.has(definition.id)) {
    throw new Error(
      `memoized-dom: root entity '${definition.id}' is already mounted`,
    );
  }
  if (mountedRoots.size > 0) {
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
      mountedHosts.delete(host);
      mountedRoots.delete(definition.id);
      try {
        unregisterSubtree(definition.id);
      } finally {
        removeNodes(nodes);
      }
    },
  };
  mountedHosts.set(host, application);
  mountedRoots.set(definition.id, application);
  return application;
}

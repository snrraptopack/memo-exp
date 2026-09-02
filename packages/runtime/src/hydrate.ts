/**
 * SSR hydration entry. Importing this subpath opts the client into marker
 * parsing, DOM adoption, payload restoration, and mismatch recovery.
 */
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
import {
  mount,
  mountStore,
  removeNodes,
  resolveHost,
  rootFactoryFor,
  type MountableComponent,
  type MountTarget,
  type MountedApplication,
} from './mount';

export interface HydrationPayloadDelivery {
  readonly version: 1;
  readonly state?: unknown;
}

export interface HydrateOptions {
  /** Recover a root mismatch by discarding server markup and mounting fresh. */
  recover?: boolean;
  /** Called when a mismatch is recovered. */
  onRecover?: (error: HydrationMismatchError) => void;
  /** DOM-embedded payload lookup, an explicit payload, or no restoration. */
  payload?: 'auto' | 'none' | HydrationPayloadDelivery;
}

/** Adopt server-rendered DOM within the compiled application root boundary. */
export function hydrate(
  target: MountTarget,
  component: MountableComponent,
  options: HydrateOptions = {},
): MountedApplication {
  const host = resolveHost(target);
  const store = mountStore();
  if (store.mountedHosts.has(host)) {
    throw new Error('memoized-dom: mount target already owns an application');
  }
  const definition = rootFactoryFor(component);
  if (definition === undefined) {
    throw new Error(
      'memoized-dom: hydrate received a component that is not a compiled application root',
    );
  }
  if (store.mountedRoots.has(definition.id) || store.mountedRoots.size > 0) {
    throw new Error(
      `memoized-dom: root entity '${definition.id}' is already mounted`,
    );
  }

  restorePayload(definition.id, options.payload);
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
    if (options.recover && error instanceof HydrationMismatchError) {
      options.onRecover?.(error);
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
      store.mountedHosts.delete(host);
      store.mountedRoots.delete(definition.id);
      try {
        unregisterSubtree(definition.id);
      } finally {
        removeNodes(nodes);
        range.open.parentNode?.removeChild(range.open);
        range.end.parentNode?.removeChild(range.end);
      }
    },
  };
  store.mountedHosts.set(host, application);
  store.mountedRoots.set(definition.id, application);
  return application;
}

function restorePayload(
  rootId: string,
  payload: HydrateOptions['payload'],
): void {
  if (payload === 'none') return;
  let value: unknown = typeof payload === 'object' ? payload : undefined;
  if (value === undefined && typeof globalThis.document !== 'undefined') {
    const script = globalThis.document.querySelector(
      `script[type="application/mmd+json"][data-mmd-root="${rootId}"]`,
    );
    if (script?.textContent) {
      try {
        value = JSON.parse(script.textContent);
      } catch {
        // Corrupt state is ignored; the data runtime acquires fresh values.
      }
    }
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'state' in value &&
    value.state !== undefined
  ) {
    const data = getExtensionStore<{ restoreState?(state: unknown): void }>(
      'mmd:data-runtime-active',
      () => ({}),
    );
    data.restoreState?.(value.state);
  }
}

export {
  createHydrationCursor,
  HydrationDocument,
  HydrationMismatchError,
  HydrationMarkerIndex,
  HydrationNodePlan,
  LocalHydrationCursor,
  parseHydrationMarker,
} from './hydration';
export type {
  ClaimedHydrationRange,
  HydrationCloseMarker,
  HydrationController,
  HydrationMarker,
  HydrationMarkerKind,
  HydrationNodeExpectation,
  HydrationOpenMarker,
  PairedHydrationMarkerKind,
} from './hydration';

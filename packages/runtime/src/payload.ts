/** Optional data restoration shared by initial bindings and general adoption. */
import type { MountedApplication, RootFactoryDefinition } from './mount-core';
import { getExtensionStore, unregisterSubtree } from './kernel';

interface Payload {
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
const routerRuntimeBridgeKey = Symbol.for('memoized-dom:router-runtime-bridge');

function restorePayload(rootId: string, host: Element) {
  const data = getExtensionStore<DataRuntimeBridge>('mmd:data-runtime-active', () => ({}));
  const script = [...host.ownerDocument.querySelectorAll(
    'script[type="application/mmd+json"][data-mmd-root]',
  )].find(candidate => candidate.getAttribute('data-mmd-root') === rootId);
  if (!script?.textContent) return { data, script };
  let parsed: unknown;
  try { parsed = JSON.parse(script.textContent); }
  catch { return { data, script }; }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1) {
    return { data, script };
  }
  const payload = parsed as Payload;
  if (payload.state !== undefined) {
    if (data.restoreState) {
      // An incompatible envelope can fall back to the source's normal fetch.
      try { data.restoreState(payload.state); } catch { /* malformed envelope */ }
    } else {
      // The data package may register its default runtime after bootstrap.
      data.pendingState = payload.state;
    }
  }
  if (payload.routed !== undefined) {
    const realm = globalThis as unknown as Record<PropertyKey, unknown>;
    const existing = realm[routerRuntimeBridgeKey];
    const router = (typeof existing === 'object' && existing !== null ? existing
      : realm[routerRuntimeBridgeKey] = {}) as RouterRuntimeBridge;
    if (router.restoreState) router.restoreState(payload.routed);
    else router.pendingState = payload.routed;
  }
  return { data, script };
}

/** Restore before mounting; finish or cancel the same data handoff exactly once. */
export function initializePayload(
  host: Element,
  definition: RootFactoryDefinition,
  initialize: () => MountedApplication,
  recoverable?: (error: unknown) => boolean,
): MountedApplication {
  const restoration = restorePayload(definition.id, host);
  let mounted: MountedApplication;
  try {
    mounted = initialize();
  } catch (error) {
    unregisterSubtree(definition.id);
    if (recoverable?.(error)) restoration.data.completeHydration?.();
    else restoration.data.cancelHydration?.();
    restoration.script?.remove();
    throw error;
  }
  try { restoration.data.completeHydration?.(); }
  finally { restoration.script?.remove(); }
  return mounted;
}

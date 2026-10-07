/** Optional data restoration shared by initial bindings and general adoption. */
import type { MountedApplication, RootFactoryDefinition } from './mount-core';
import { getActiveApplicationRuntime, getExtensionStore, runInApplicationRuntime, unregisterSubtree } from './kernel';

interface Payload {
  readonly version: 1;
  readonly streaming?: true;
  readonly state?: unknown;
  readonly routed?: unknown;
}
interface DataRuntimeBridge {
  restoreState?(state: unknown): void;
  completeHydration?(): void;
  cancelHydration?(): void;
  deliverStreamedState?(state: unknown): void;
  endStream?(): void;
  pendingState?: unknown;
}
/**
 * Streamed SSR chunks run inline scripts. Before a root mounts they patch the
 * server DOM and payload; afterwards the root owns its DOM, so they hand the
 * data to its runtime instead.
 */
interface StreamRealm {
  readonly roots: Map<string, DataRuntimeBridge>;
  owns(rootId: string): boolean;
  deliver(rootId: string, state: unknown): void;
}
const streamRealmKey = Symbol.for('memoized-dom:stream');

function streamRealm(): StreamRealm {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[streamRealmKey] as StreamRealm | undefined;
  if (existing !== undefined) return existing;
  const roots = new Map<string, DataRuntimeBridge>();
  const created: StreamRealm = {
    roots,
    owns: rootId => roots.has(rootId),
    deliver(rootId, state) {
      // A malformed late chunk falls back to the source's normal fetch.
      try { roots.get(rootId)?.deliverStreamedState?.(state); } catch { /* malformed chunk */ }
    },
  };
  realm[streamRealmKey] = created;
  return created;
}

/** The response is complete once parsing ends; undelivered sources then fetch. */
function endStreamAfterParsing(document: Document, data: DataRuntimeBridge): () => void {
  const end = () => data.endStream?.();
  if (document.readyState !== 'loading') end();
  else document.addEventListener('DOMContentLoaded', end, { once: true });
  return () => document.removeEventListener('DOMContentLoaded', end);
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
  return { data, script, streamed: payload.streaming === true };
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
    if (restoration.streamed) endStreamAfterParsing(host.ownerDocument, restoration.data);
    throw error;
  }
  try { restoration.data.completeHydration?.(); }
  finally { restoration.script?.remove(); }
  if (restoration.streamed) {
    const runtime = getActiveApplicationRuntime();
    const data: DataRuntimeBridge = {
      deliverStreamedState: state => runInApplicationRuntime(runtime, () => restoration.data.deliverStreamedState?.(state)),
      endStream: () => runInApplicationRuntime(runtime, () => restoration.data.endStream?.()),
    };
    const realm = streamRealm();
    realm.roots.set(definition.id, data);
    const stopParsing = endStreamAfterParsing(host.ownerDocument, data);
    const unmount = mounted.unmount;
    mounted.unmount = () => {
      stopParsing();
      if (realm.roots.get(definition.id) === data) realm.roots.delete(definition.id);
      unmount.call(mounted);
    };
  }
  return mounted;
}

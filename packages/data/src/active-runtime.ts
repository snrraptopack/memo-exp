/**
 * Ambient data-runtime selection (SSR request isolation).
 *
 * The default `$fetch`/`$action` exports are singleton-backed. Server
 * rendering activates a request-local data runtime for the duration of its
 * synchronous work; with no override active every export behaves exactly as
 * before.
 */

import { getExtensionStore } from '@memoized-dom/runtime';
import { createDataRuntime } from './client';
import type { DataRuntime } from './types';

const defaultDataRuntime = createDataRuntime();

function syncActiveStore(runtime: DataRuntime): void {
  const store = getExtensionStore<{ restoreState?(s: unknown): void }>(
    'mmd:data-runtime-active',
    () => ({}),
  );
  store.restoreState = (s) => runtime.restoreState(s as import('./types').SerializedDataState);
}

syncActiveStore(defaultDataRuntime);

let activeOverride: DataRuntime | null = null;

export function getActiveDataRuntime(): DataRuntime {
  return activeOverride ?? defaultDataRuntime;
}

/** Activate a runtime; returns the previous active runtime for restoration. */
export function setActiveDataRuntime(
  runtime: DataRuntime | null,
): DataRuntime {
  const previous = getActiveDataRuntime();
  activeOverride = runtime;
  syncActiveStore(getActiveDataRuntime());
  return previous;
}

/**
 * Ambient data-runtime selection (SSR request isolation).
 *
 * The default `$fetch`/`$action` exports are singleton-backed. Server
 * rendering activates a request-local data runtime for the duration of its
 * synchronous work; with no override active every export behaves exactly as
 * before.
 */

import { createStorage } from '@memoized-dom/runtime';
import { getExtensionStore } from '@memoized-dom/runtime';
import { createDataRuntime } from './client';
import type { DataRuntime, SerializedDataState } from './types';

interface ActiveDataRuntimeBridge {
  restoreState?(state: unknown): void;
  pendingState?: unknown;
}

const asyncLocalStorage = createStorage<DataRuntime>('data');
let activeOverride: DataRuntime | null = null;
let defaultDataRuntime: DataRuntime | undefined;
const activeStore = getExtensionStore<ActiveDataRuntimeBridge>(
  'mmd:data-runtime-active',
  () => ({}),
);
let pendingState = activeStore.pendingState;
delete activeStore.pendingState;

function defaultRuntime(): DataRuntime {
  defaultDataRuntime ??= createDataRuntime();
  return defaultDataRuntime;
}

export function getActiveDataRuntime(): DataRuntime {
  const runtime = asyncLocalStorage.getStore() ?? activeOverride ?? defaultRuntime();
  if (pendingState !== undefined) {
    const state = pendingState;
    pendingState = undefined;
    runtime.restoreState(state as SerializedDataState);
  }
  return runtime;
}

// Register the bridge without constructing the default runtime. mount() can
// restore immediately after the module graph finishes evaluating, avoiding
// eager-init cycles in optimized browser bundles.
activeStore.restoreState = state => {
  getActiveDataRuntime().restoreState(state as SerializedDataState);
};

export function runWithDataRuntime<T>(runtime: DataRuntime, fn: () => T): T {
  return asyncLocalStorage.run(runtime, fn);
}

/** Activate a runtime; returns the previous active runtime for restoration. */
export function setActiveDataRuntime(
  runtime: DataRuntime | null,
): DataRuntime {
  const previous = getActiveDataRuntime();
  activeOverride = runtime;
  return previous;
}

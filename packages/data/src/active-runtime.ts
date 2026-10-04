/**
 * Ambient data-runtime selection (SSR request isolation).
 *
 * The default `$fetch`/`$read` exports are singleton-backed. Server
 * rendering activates a request-local data runtime for the duration of its
 * synchronous work; with no override active every export behaves exactly as
 * before.
 */

import { createStorage } from '@memoized-dom/runtime';
import { getExtensionStore } from '@memoized-dom/runtime';
import {
  cancelDataHydration,
  createCoreDataRuntime,
  resumeDataHydration,
  type CoreDataRuntime,
} from './runtime-core';
import type { SerializedDataState } from './types';

interface ActiveDataRuntimeBridge {
  restoreState?(state: unknown): void;
  completeHydration?(): void;
  cancelHydration?(): void;
  pendingState?: unknown;
}

const asyncLocalStorage = createStorage<CoreDataRuntime>('data');
let activeOverride: CoreDataRuntime | null = null;
let defaultDataRuntime: CoreDataRuntime | undefined;
const activeStore = getExtensionStore<ActiveDataRuntimeBridge>(
  'mmd:data-runtime-active',
  () => ({}),
);
let pendingState = activeStore.pendingState;
delete activeStore.pendingState;

function defaultRuntime(): CoreDataRuntime {
  defaultDataRuntime ??= createCoreDataRuntime();
  return defaultDataRuntime;
}

export function getActiveDataRuntime(): CoreDataRuntime {
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
activeStore.completeHydration = () => {
  resumeDataHydration(getActiveDataRuntime());
};
activeStore.cancelHydration = () => {
  const runtime = getActiveDataRuntime();
  cancelDataHydration(runtime);
  runtime.clear();
};

export function runWithDataRuntime<T>(runtime: CoreDataRuntime, fn: () => T): T {
  return asyncLocalStorage.run(runtime, fn);
}

/** Activate a runtime; returns the previous active runtime for restoration. */
export function setActiveDataRuntime(
  runtime: CoreDataRuntime | null,
): CoreDataRuntime {
  const previous = getActiveDataRuntime();
  activeOverride = runtime;
  return previous;
}

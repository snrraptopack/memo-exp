/**
 * Ambient data-runtime selection (SSR request isolation).
 *
 * The default `$fetch`/`$read` exports are singleton-backed. Server
 * rendering activates a request-local data runtime for the duration of its
 * synchronous work; with no override active every export behaves exactly as
 * before.
 */

import { createStorage } from '@memoized-dom/runtime';
import {
  createCoreDataRuntime,
  type CoreDataRuntime,
} from './runtime-core';

const asyncLocalStorage = createStorage<CoreDataRuntime>('data');
let activeOverride: CoreDataRuntime | null = null;
let defaultDataRuntime: CoreDataRuntime | undefined;
let initializeRuntime: ((runtime: CoreDataRuntime) => void) | undefined;

/** Optional delivery capability; does not eagerly construct the singleton. */
export function installActiveRuntimeInitializer(initialize: (runtime: CoreDataRuntime) => void): void {
  initializeRuntime = initialize;
}

function defaultRuntime(): CoreDataRuntime {
  defaultDataRuntime ??= createCoreDataRuntime();
  return defaultDataRuntime;
}

export function getActiveDataRuntime(): CoreDataRuntime {
  const runtime = asyncLocalStorage.getStore() ?? activeOverride ?? defaultRuntime();
  initializeRuntime?.(runtime);
  return runtime;
}

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

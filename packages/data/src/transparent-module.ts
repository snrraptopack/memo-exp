/**
 * transparent-module.ts — RFC §16.4: module sources are immutable
 * descriptions, not live requests.
 *
 * Authored module-scope sources:
 *
 *   // session.ts
 *   export const currentUser = $fetch<User>('/api/session');
 *
 * compile to a lazy description plus a stable reference:
 *
 *   _MDD.describeModuleSource('./session.ts#currentUser', () =>
 *     _MDD.createSource('/api/session', {}));
 *   export const currentUser = _MDD.sourceRef('./session.ts#currentUser');
 *
 * The description never executes at module evaluation. The FIRST read inside
 * an ApplicationRuntime materializes the source into that runtime's private
 * cache — request-local on the server, shared on the client — and every later
 * read in the same runtime reuses the instance. Disposal follows the runtime
 * (extension stores clear with it) and `DataRuntime.clear()` still aborts and
 * empties the underlying store.
 */

import { getExtensionStore } from '@memoized-dom/runtime';
import { getActiveDataRuntime } from './active-runtime';
import type { FetchOptions, ResolvedValue } from './types';

/** Stable lazy handle placed in the authored binding. */
export interface ModuleSourceRef {
  readonly __mmdModuleSource: true;
  readonly key: string;
}

type SourceFactory = () => ResolvedValue<unknown>;

const describedFactories = new Map<string, SourceFactory>();

/**
 * Register (or replace) the factory for a module-scope source. Called by the
 * compiled declaration; replacing an existing factory is how HMR updates a
 * module without leaking its previous request instances.
 */
export function describeModuleSource<T>(
  key: string,
  create: () => ResolvedValue<T>,
): void {
  describedFactories.set(key, create as SourceFactory);
}

function runtimeCache(): Map<string, unknown> {
  return getExtensionStore('mmd:module-source-instances', () => new Map());
}

/**
 * Materialize — once per ApplicationRuntime — the source a ref points at.
 * The factory runs under whatever runtime is active, so `$fetch` binds to
 * that request's data runtime.
 */
export function resolveModuleSource<T>(ref: ModuleSourceRef): ResolvedValue<T> {
  const cache = runtimeCache();
  let instance = cache.get(ref.key) as ResolvedValue<T> | undefined;
  if (instance === undefined) {
    const factory = describedFactories.get(ref.key);
    if (factory === undefined) {
      throw new Error(
        `[memo-dom] module source '${ref.key}' has no registered description`,
      );
    }
    instance = factory() as ResolvedValue<T>;
    cache.set(ref.key, instance);
  }
  return instance;
}

export function isModuleSourceRef(value: unknown): value is ModuleSourceRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __mmdModuleSource?: boolean }).__mmdModuleSource === true
  );
}

/** Compiled form of an authored module-scope declaration. */
export function sourceRef(key: string): ModuleSourceRef {
  return { __mmdModuleSource: true, key };
}

/** Create a fetch resource bound to the ACTIVE data runtime. */
export function createSource<T>(
  target: string | URL | null,
  options?: FetchOptions,
): ResolvedValue<T> {
  return getActiveDataRuntime().$fetch(
    target,
    options,
  ) as unknown as ResolvedValue<T>;
}

/**
 * List-view read for module sources: committed data renders rows; an
 * unavailable source renders zero rows (§10: no Group → empty local region);
 * an initial failure stays loud.
 */
export function readModuleSourceList<T>(ref: ModuleSourceRef): T[] {
  const instance = resolveModuleSource<T>(ref);
  const loose = instance as unknown as {
    status?: string;
    data?: T[];
    error?: unknown;
  };
  if (
    loose.status === 'error' &&
    loose.error !== null &&
    loose.error !== undefined
  ) {
    throw loose.error;
  }
  return Array.isArray(loose.data) ? loose.data : [];
}

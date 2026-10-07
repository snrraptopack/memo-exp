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
import { enableRequestEncoding } from './request-encoding';
import { disposeFetchResource, rebindFetchResource } from './resource';
import type { FetchOptions, FetchResource, ResolvedValue } from './types';
import { enableDataReads, rebindReadResource } from './read-resource';
import { registerDataRuntimeDisposer } from './runtime-lifetime';
import { readResolvedValueForRender } from './transparent';

/** Stable lazy handle placed in the authored binding. */
export interface ModuleSourceRef {
  readonly __mmdModuleSource: true;
  readonly key: string;
}

type SourceFactory = () => unknown;

interface DescribedSource {
  readonly factory: SourceFactory;
  /** Bumped on every describeModuleSource replacement (HMR re-evaluation). */
  version: number;
}

interface CachedInstance {
  readonly instance: unknown;
  /** Description version this instance was materialized from. */
  version: number;
}

const describedSources = new Map<string, DescribedSource>();

/**
 * Register (or replace) the factory for a module-scope source. Called by the
 * compiled declaration; replacing an existing factory bumps the description
 * version so HMR re-evaluation RETIRES stale materialized instances in every
 * runtime instead of silently reusing them (RFC §16.4 lifecycle contract).
 */
export function describeModuleSource<T>(
  key: string,
  create: () => ResolvedValue<T>,
): void {
  const existing = describedSources.get(key);
  describedSources.set(key, {
    factory: create as SourceFactory,
    version: (existing?.version ?? 0) + 1,
  });
}

function runtimeCache(): Map<string, CachedInstance> {
  return getExtensionStore('mmd:module-source-instances', () => new Map());
}

/**
 * Materialize — once per ApplicationRuntime and per description version —
 * active, so `$fetch` binds to that request's data runtime. A version
 * mismatch (HMR replaced the description) drops the stale instance.
 */
export function resolveModuleSource<T>(ref: ModuleSourceRef): ResolvedValue<T> {
  const cache = runtimeCache();
  const described = describedSources.get(ref.key);
  if (described === undefined) {
    throw new Error(
      `[memo-dom] module source '${ref.key}' has no registered description`,
    );
  }
  const cached = cache.get(ref.key);
  if (cached !== undefined) {
    if (cached.version === described.version) {
      return cached.instance as ResolvedValue<T>;
    }
    // HMR replaced the immutable description. Retire the old request before
    // replacing it so subscriptions and in-flight work cannot outlive the
    // stale module version.
    disposeFetchResource(
      cached.instance as unknown as FetchResource<unknown>,
    );
  }
  const instance = described.factory() as ResolvedValue<T>;
  const entry: CachedInstance = {
    instance,
    version: described.version,
  };
  cache.set(ref.key, entry);
  registerDataRuntimeDisposer(getActiveDataRuntime(), () => {
    // Clearing an older DataRuntime after HMR must not evict the replacement
    // installed in the same ApplicationRuntime cache.
    if (cache.get(ref.key) === entry) cache.delete(ref.key);
  });
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
  enableRequestEncoding(getActiveDataRuntime());
  return createBodylessSource(target, options);
}

/** Compiler-proved requests without body inputs share the same fetch engine. */
export function createBodylessSource<T>(
  target: string | URL | null,
  options?: FetchOptions,
): ResolvedValue<T> {
  return getActiveDataRuntime().$fetch(
    target,
    options,
  ) as unknown as ResolvedValue<T>;
}

/** Materialize a compiler-described `$read` in the active request runtime. */
export function createReadSource<T>(
  promise: PromiseLike<T>,
  replay: () => PromiseLike<T>,
): ResolvedValue<T> {
  return enableDataReads(getActiveDataRuntime()).$read(promise, replay) as unknown as ResolvedValue<T>;
}

/** Rebind only an already-materialized module read source. */
export function rebindReadModuleSource<T>(
  ref: ModuleSourceRef,
  replay: () => PromiseLike<T>,
): void {
  const cached = runtimeCache().get(ref.key);
  const described = describedSources.get(ref.key);
  if (cached === undefined || cached.version !== described?.version) return;
  try {
    rebindReadResource(cached.instance as FetchResource<T>, replay(), replay);
  } catch (cause) {
    rebindReadResource(cached.instance as FetchResource<T>, Promise.reject(cause), replay);
  }
}

/**
 * Compiler hook for reactive module-scope request inputs. It deliberately
 * does not materialize an unused description; the first real consumer still
 * owns lazy request creation.
 */
export function rebindModuleSource<T>(
  ref: ModuleSourceRef,
  target: string | URL | null,
  options: FetchOptions = {},
): void {
  const cached = runtimeCache().get(ref.key);
  const described = describedSources.get(ref.key);
  if (cached === undefined || cached.version !== described?.version) return;
  rebindFetchResource(
    cached.instance as unknown as FetchResource<T>,
    target,
    options,
  );
}

/**
 * List-view read for module sources: committed data renders rows; an
 * unavailable source renders zero rows (§10: no Group → empty local region);
 * an initial failure stays loud.
 */
export function readModuleSourceList<T>(ref: ModuleSourceRef): T[] {
  const data = readResolvedValueForRender(ref as unknown as ResolvedValue<T[]>);
  return Array.isArray(data) ? data : [];
}

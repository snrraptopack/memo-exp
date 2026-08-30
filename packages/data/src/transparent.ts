import { RequestError } from './errors';
import {
  disposeFetchResource,
  fetchResourceSnapshot,
  subscribeFetchResource,
} from './resource';
import type {
  FetchResource,
  GroupProps,
  PendingProps,
  ErrorProps,
  ResolvedValue,
  ResourceListener,
  ResourceSnapshot,
  TrackedValue,
} from './types';
import {
  isModuleSourceRef,
  resolveModuleSource,
  type ModuleSourceRef,
} from './transparent-module';

/** Raised when imperative code reads a transparent value before first commit. */
export class UnresolvedDataReadError extends globalThis.Error {
  override readonly name = 'UnresolvedDataReadError';

  constructor(
    readonly binding?: string,
    readonly site?: string,
  ) {
    const location = binding === undefined
      ? ''
      : ` '${binding}'${site === undefined ? '' : ` at ${site}`}`;
    super(`Transparent data value${location} was read before it committed`);
  }
}

function compileOnly(name: string): never {
  throw new globalThis.Error(
    `[memo-dom/data] <${name}> is compile-time syntax and cannot execute without the Memoized DOM compiler`,
  );
}

/** Compile-time local data presentation policy. */
export function Group(_props: GroupProps): never {
  return compileOnly('Group');
}

/** Compile-time pending policy declaration consumed by Group. */
export function Pending(_props: PendingProps): never {
  return compileOnly('Pending');
}

/** Compile-time error policy declaration consumed by Group. */
export function Error(_props: ErrorProps): never {
  return compileOnly('Error');
}

/**
 * The compiler keeps a FetchResource (or, for module sources, materializes a
 * per-runtime instance from the source's lazy description) behind authored
 * ResolvedValue<T> bindings. These casts are centralized here so no payload
 * object is decorated and no payload identity lookup is required.
 */
function resolveTarget<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
): FetchResource<T> {
  if (isModuleSourceRef(value)) {
    return resolveModuleSource(value) as unknown as FetchResource<T>;
  }
  return value as unknown as FetchResource<T>;
}

function source<T>(value: ResolvedValue<T> | ModuleSourceRef): FetchResource<T> {
  return resolveTarget(value);
}

export function trackResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
): TrackedValue<T> {
  return source(value) as unknown as TrackedValue<T>;
}

/** Resolve an honest payload for an imperative/derived read. */
export function readResolvedValue<T>(
  value: ResolvedValue<T>,
  binding?: string,
  site?: string,
): T {
  const snapshot = fetchResourceSnapshot(source(value));
  if (snapshot.status === 'success') return snapshot.data as T;
  if (snapshot.status === 'error' && snapshot.error !== null) {
    throw snapshot.error;
  }
  throw new UnresolvedDataReadError(binding, site);
}

/**
 * Render-site read: initial absence leaves the local sink unset, while an
 * initial request failure remains loud. Group lowering will layer local
 * Pending/Error policy over this primitive.
 */
export function readResolvedValueForRender<T>(
  value: ResolvedValue<T>,
): T | undefined {
  const snapshot = fetchResourceSnapshot(source(value));
  if (snapshot.status === 'success') return snapshot.data as T;
  if (snapshot.status === 'error' && snapshot.error !== null) {
    throw snapshot.error;
  }
  return undefined;
}

/** Execute a render/derivation expression only when every input is honest. */
export function readResolvedValuesForRender<TResult>(
  values: readonly ResolvedValue<unknown>[],
  compute: (...resolved: unknown[]) => TResult,
): TResult | undefined {
  const resolved: unknown[] = [];
  for (const value of values) {
    const snapshot = fetchResourceSnapshot(source(value));
    if (snapshot.status === 'error' && snapshot.error !== null) {
      throw snapshot.error;
    }
    if (snapshot.status !== 'success') return undefined;
    resolved.push(snapshot.data);
  }
  return compute(...resolved);
}

/**
 * Replay a derivation only after every prerequisite has committed. Failures
 * remain on the source so the eventual consumption site can select Error UI.
 */
export function deriveResolvedValues<TResult>(
  values: readonly ResolvedValue<unknown>[],
  compute: (...resolved: unknown[]) => TResult,
): TResult | undefined {
  const resolved: unknown[] = [];
  for (const value of values) {
    const snapshot = fetchResourceSnapshot(source(value));
    if (snapshot.status !== 'success') return undefined;
    resolved.push(snapshot.data);
  }
  return compute(...resolved);
}

export function resolvedValuesError(
  values: readonly ResolvedValue<unknown>[],
): RequestError | null {
  for (const value of values) {
    const error = fetchResourceSnapshot(source(value)).error;
    if (error !== null) return error;
  }
  return null;
}

export function resolvedValuesErrorIndex(
  values: readonly ResolvedValue<unknown>[],
): number {
  return values.findIndex(value =>
    fetchResourceSnapshot(source(value)).error !== null
  );
}

export function resolvedValuesPending(
  values: readonly ResolvedValue<unknown>[],
): boolean {
  if (resolvedValuesError(values) !== null) return false;
  return values.some(value =>
    fetchResourceSnapshot(source(value)).status !== 'success'
  );
}

export function resolvedValuesPendingIndex(
  values: readonly ResolvedValue<unknown>[],
): number {
  return values.findIndex(value => {
    const snapshot = fetchResourceSnapshot(source(value));
    return snapshot.error === null && snapshot.status !== 'success';
  });
}

export function throwResolvedValuesError(
  values: readonly ResolvedValue<unknown>[],
): never {
  const error = resolvedValuesError(values);
  if (error !== null) throw error;
  throw new UnresolvedDataReadError();
}

/** Retry the failed prerequisite selected for one local error site. */
export function retryResolvedValues(
  values: readonly ResolvedValue<unknown>[],
): Promise<unknown> {
  for (const value of values) {
    const snapshot = fetchResourceSnapshot(source(value));
    if (snapshot.error !== null) return source(value).refresh();
  }
  return Promise.resolve();
}

export function resolvedValueSnapshot<T>(
  value: ResolvedValue<T>,
): ResourceSnapshot<T> {
  return fetchResourceSnapshot(source(value));
}

/** Subscribe to transitions without delivering the notifier's initial value. */
export function observeResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
  listener: ResourceListener<T>,
): () => void {
  let initial = true;
  return subscribeFetchResource(source(value), snapshot => {
    if (initial) {
      initial = false;
      return;
    }
    listener(snapshot);
  });
}

/** Attach one compiled structural owner to a component-local source. */
export function connectResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
  invalidate: () => void,
  owned = true,
): () => void {
  const unsubscribe = observeResolvedValue(value, () => invalidate());
  return () => {
    unsubscribe();
    // Module sources live with their ApplicationRuntime — consumers only
    // detach; disposal authority stays with the runtime.
    if (owned && !isModuleSourceRef(value)) {
      disposeFetchResource(source(value));
    }
  };
}

/** Subscribe one exact compiler-emitted entity to all of its prerequisites. */
export function connectResolvedValues(
  values: readonly ResolvedValue<unknown>[],
  invalidate: () => void,
): () => void {
  const unsubscribes = values.map(value =>
    observeResolvedValue(value, invalidate)
  );
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/** Give one creating component sole disposal authority over a local source. */
export function ownResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
): () => void {
  // Module sources are disposed with their ApplicationRuntime.
  if (isModuleSourceRef(value)) return () => {};
  return () => disposeFetchResource(source(value));
}

export function isInitialDataFailure(error: unknown): error is RequestError {
  return error instanceof RequestError;
}

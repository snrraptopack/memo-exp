import { RequestError, toRequestError } from './errors';
import {
  disposeFetchResource,
  fetchResourceOperationId,
  fetchResourceSnapshot,
  rebindFetchResource,
  rebindFetchResourceFrom,
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

const trackedValues = new WeakMap<object, TrackedValue<unknown>>();
const trackedPromises = new WeakMap<object, TrackedValue<unknown>>();
let nextTrackedPromiseId = 1;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  ) && typeof (value as PromiseLike<unknown>).then === 'function';
}

function notifyTrackedPromiseListeners<T>(
  listeners: readonly ((value: T, requestId: string) => void)[],
  value: T,
  requestId: string,
): void {
  const failures: unknown[] = [];
  for (const listener of listeners) {
    try {
      listener(value, requestId);
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 0) return;
  const failure = failures.length === 1
    ? failures[0]
    : new AggregateError(failures, 'Tracked promise listeners failed');
  try {
    (globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }).reportError?.(failure);
  } catch {
    // Reporting must not turn a fulfilled promise into a failed refresh.
  }
}

function trackPromise<T>(promise: PromiseLike<T>): TrackedValue<T> {
  const key = promise as object;
  const existing = trackedPromises.get(key);
  if (existing !== undefined) return existing as TrackedValue<T>;

  const id = `promise-${nextTrackedPromiseId++}`;
  let value: T | undefined;
  let status: TrackedValue<T>['status'] = 'pending';
  let error: RequestError | null = null;
  const successListeners = new Set<(data: T, requestId: string) => void>();
  const errorListeners = new Set<(
    failure: RequestError,
    requestId: string,
  ) => void>();
  const settled = Promise.resolve(promise).then(
    result => {
      value = result;
      status = 'success';
      const listeners = [...successListeners];
      successListeners.clear();
      errorListeners.clear();
      notifyTrackedPromiseListeners(listeners, result, id);
      return result;
    },
    reason => {
      error = toRequestError(reason);
      status = 'error';
      const listeners = [...errorListeners];
      successListeners.clear();
      errorListeners.clear();
      notifyTrackedPromiseListeners(listeners, error, id);
      throw error;
    },
  );
  // Tracking observes rejection through state/callbacks. Keep that observation
  // from creating a second, unhandled rejection when callers do not refresh().
  void settled.catch(() => {});

  const tracked: TrackedValue<T> = Object.freeze({
    id,
    get value() { return value; },
    get status() { return status; },
    get pending() { return status === 'pending'; },
    refreshing: false,
    get error() { return error; },
    onSuccess(callback: (data: T, requestId: string) => void) {
      if (status === 'success') {
        callback(value as T, id);
        return () => {};
      }
      if (status !== 'pending') return () => {};
      successListeners.add(callback);
      return () => successListeners.delete(callback);
    },
    onError(callback: (failure: RequestError, requestId: string) => void) {
      if (status === 'error') {
        callback(error as RequestError, id);
        return () => {};
      }
      if (status !== 'pending') return () => {};
      errorListeners.add(callback);
      return () => errorListeners.delete(callback);
    },
    // A promise represents one execution, so refresh awaits that same work.
    refresh: () => settled,
    // Arbitrary promises have no cancellation protocol.
    abort: () => {},
  });
  trackedPromises.set(key, tracked as TrackedValue<unknown>);
  return tracked;
}

function observeTrackedOutcome<T>(
  resource: FetchResource<T>,
  outcome: 'success' | 'error',
  callback: (value: T | RequestError, requestId: string) => void,
): () => void {
  const requestId = fetchResourceOperationId(resource);
  let active = true;
  let unsubscribe: () => void = () => {};
  const stop = (): void => {
    if (!active) return;
    active = false;
    unsubscribe();
  };
  const listener = (snapshot: ResourceSnapshot<T>): void => {
    if (!active) return;
    if (fetchResourceOperationId(resource) !== requestId) {
      stop();
      return;
    }
    if (
      outcome === 'success' &&
      snapshot.status === 'success' &&
      !snapshot.pending &&
      !snapshot.refreshing &&
      snapshot.error === null
    ) {
      active = false;
      callback(snapshot.data as T, requestId);
      unsubscribe();
      return;
    }
    if (
      outcome === 'error' &&
      !snapshot.pending &&
      !snapshot.refreshing &&
      snapshot.error !== null
    ) {
      active = false;
      callback(snapshot.error, requestId);
      unsubscribe();
    }
  };
  unsubscribe = subscribeFetchResource(resource, listener);
  if (!active) unsubscribe();
  return stop;
}

export function trackResolvedValue<T>(value: PromiseLike<T>): TrackedValue<T>;
export function trackResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
): TrackedValue<T>;
export function trackResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef | PromiseLike<T>,
): TrackedValue<T>;
export function trackResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef | PromiseLike<T>,
): TrackedValue<T> {
  if (isPromiseLike(value)) return trackPromise(value as PromiseLike<T>);
  const resource = source(value);
  const existing = trackedValues.get(resource);
  if (existing !== undefined) return existing as TrackedValue<T>;
  const tracked: TrackedValue<T> = Object.freeze({
    get id() { return fetchResourceOperationId(resource); },
    get value() { return resource.data; },
    get status() { return resource.status; },
    get pending() { return resource.pending; },
    get refreshing() { return resource.refreshing; },
    get error() { return resource.error; },
    onSuccess(callback: (data: T, requestId: string) => void) {
      return observeTrackedOutcome(
        resource,
        'success',
        (value, requestId) => callback(value as T, requestId),
      );
    },
    onError(callback: (error: RequestError, requestId: string) => void) {
      return observeTrackedOutcome(
        resource,
        'error',
        (value, requestId) => callback(value as RequestError, requestId),
      );
    },
    refresh: () => resource.refresh(),
    abort: () => resource.abort(),
  });
  trackedValues.set(resource, tracked as TrackedValue<unknown>);
  return tracked;
}

/** Compiler hook: update the request behind a stable transparent binding. */
export function rebindResolvedValue<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
  target: string | URL | null,
  options: import('./types').FetchOptions = {},
): void {
  rebindFetchResource(source(value), target, options);
}

/**
 * Compiler hook for imported colorless factories. The factory remains the
 * authority on how authored arguments become a request; its newly-created
 * source is transferred into the stable binding used by rendered sites.
 */
export function rebindResolvedValueFromFactory<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
  factory: () => ResolvedValue<T>,
): void {
  if (isModuleSourceRef(value)) {
    throw new TypeError('Module source references cannot adopt a local source');
  }
  rebindFetchResourceFrom(source(value), source(factory()));
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
  value: ResolvedValue<T> | null | undefined,
): T | undefined {
  if (value === null || value === undefined) return undefined;
  const snapshot = fetchResourceSnapshot(source(value));
  if (snapshot.status === 'success') return snapshot.data as T;
  if (snapshot.status === 'error' && snapshot.error !== null) {
    throw snapshot.error;
  }
  return undefined;
}

/** Execute a render/derivation expression only when every input is honest. */
export function readResolvedValuesForRender<TResult>(
  values: readonly (
    | ResolvedValue<unknown>
    | null
    | undefined
  )[],
  compute: (...resolved: unknown[]) => TResult,
): TResult | undefined {
  const resolved: unknown[] = [];
  for (const value of values) {
    if (value === null || value === undefined) return undefined;
    const snapshot = fetchResourceSnapshot(source(value));
    if (snapshot.status === 'error' && snapshot.error !== null) {
      throw snapshot.error;
    }
    if (snapshot.status !== 'success') return undefined;
    resolved.push(snapshot.data);
  }
  return compute(...resolved);
}

/** Run a compiled effect only after every event-created source has settled. */
export function runResolvedValuesEffect<TResult>(
  values: readonly (
    | ResolvedValue<unknown>
    | null
    | undefined
  )[],
  run: (...resolved: unknown[]) => TResult,
): TResult | undefined {
  return readResolvedValuesForRender(values, run);
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

/** Retry every failed prerequisite represented by one local error site. */
export function retryResolvedValues(
  values: readonly ResolvedValue<unknown>[],
): Promise<unknown> {
  const retries: Promise<unknown>[] = [];
  for (const value of values) {
    const snapshot = fetchResourceSnapshot(source(value));
    if (snapshot.error !== null) retries.push(source(value).refresh());
  }
  if (retries.length === 0) return Promise.resolve();
  return Promise.all(retries);
}

export function resolvedValueSnapshot<T>(
  value: ResolvedValue<T>,
): ResourceSnapshot<T> {
  return fetchResourceSnapshot(source(value));
}

/**
 * Compiler hook: publish an authored in-place payload mutation to every
 * structural consumer of this source. The mutation itself has already run;
 * ResourceController.mutate supplies the ordering/notification boundary and
 * prevents an older in-flight read from overwriting the local write.
 */
export function notifyResolvedValueMutation<T>(
  value: ResolvedValue<T> | ModuleSourceRef,
): void {
  source(value).mutate(() => {});
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

/** Per-instance slot holding whichever source an event-assigned variable currently references. */
export interface EventSourceSlot {
  value: unknown;
  disconnect?: () => void;
  retired: Set<RetiredEventSource>;
}

interface RetiredEventSource {
  readonly value: ResolvedValue<unknown>;
  disconnect: () => void;
}

/** Create the slot state for one event-assigned colorless source variable. */
export function createEventSourceSlot(): EventSourceSlot {
  return { value: null, disconnect: undefined, retired: new Set() };
}

function retireEventSource(
  slot: EventSourceSlot,
  value: ResolvedValue<unknown>,
): void {
  const resource = source(value);
  const snapshot = fetchResourceSnapshot(resource);
  if (!snapshot.pending && !snapshot.refreshing) {
    disposeFetchResource(resource);
    return;
  }
  const retired: RetiredEventSource = {
    value,
    disconnect: () => {},
  };
  slot.retired.add(retired);
  retired.disconnect = subscribeFetchResource(resource, settled => {
    if (settled.pending || settled.refreshing) return;
    retired.disconnect();
    slot.retired.delete(retired);
    disposeFetchResource(resource);
  });
}

/**
 * Keep one compiler entity subscribed to the request state of whichever
 * source the slot currently holds. Event-created sources do not exist when
 * the component mounts, so the compiler re-runs this on every entity update:
 * identity comparison makes it a no-op until a new source is assigned, and a
 * replaced source is disposed with the slot taking over disposal authority.
 */
export function rebindEventSourceSlot(
  slot: EventSourceSlot,
  get: () => ResolvedValue<unknown> | null | undefined,
  invalidate: () => void,
): void {
  const value = get();
  if (value === slot.value) return;
  slot.disconnect?.();
  if (slot.value !== null && slot.value !== undefined) {
    retireEventSource(slot, slot.value as ResolvedValue<unknown>);
  }
  slot.value = value;
  slot.disconnect =
    value === null || value === undefined
      ? undefined
      : connectResolvedValue(value, invalidate, false);
}

/** Detach one slot while allowing already-dispatched work to settle honestly. */
export function disposeEventSourceSlot(slot: EventSourceSlot): void {
  slot.disconnect?.();
  slot.disconnect = undefined;
  if (slot.value !== null && slot.value !== undefined) {
    retireEventSource(slot, slot.value as ResolvedValue<unknown>);
  }
  slot.value = null;
}

export function isInitialDataFailure(error: unknown): error is RequestError {
  return error instanceof RequestError;
}

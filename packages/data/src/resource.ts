import { getActiveEnvironment } from '@memoized-dom/runtime';
import { getGlobalControllers } from './global-controllers';
import {
  isAbortError,
  RequestError,
  toRequestError,
  type RequestErrorKind,
} from './errors';
import { SnapshotNotifier } from './notifications';
import { dispatchResourceWrite } from './resource-write-capability';
import {
  disposeFormSource,
  formSourceOperationId,
  formSourceSnapshot,
  isFormSource,
  subscribeFormSource,
  type FormSource,
} from './forms';
import {
  adoptReadResource,
  disposeReadResource,
  isReadResource,
  readResourceIsLive,
  readResourceOperationId,
  readResourceSnapshot,
  subscribeReadResource,
} from './read-resource';
import {
  abortable,
  abortReason,
  decodeResponse,
  fetchIdentity,
  fetchTransferContract,
  fetchTransferIdentity,
  normalizeFetchMethod,
  normalizedHeaders,
  type PreparedRequestBody,
  resolveRequestURL,
} from './request';
import type {
  FetchCache,
  FetchMethod,
  FetchOptions,
  FetchResource,
  ResourceListener,
  ResourceSnapshot,
  SerializedDataState,
  SerializedSourceRecord,
  SerializedSourceSnapshot,
  StandardSchemaV1,
} from './types';

interface FetchDescriptor {
  readonly url: string;
  readonly method: FetchMethod;
  readonly headers: HeadersInit | undefined;
  readonly body: BodyInit | undefined;
  readonly bodyIdentity: string;
  readonly identity: string;
  readonly transferIdentity: string | null;
  readonly cache: FetchCache;
  readonly schema: StandardSchemaV1 | undefined;
  readonly signal: AbortSignal | undefined;
}

let nextRequestId = 1;

function createRequestId(): string {
  return `request-${nextRequestId++}`;
}

export interface FetchEnvironment {
  readonly fetch: () => typeof globalThis.fetch;
  readonly baseURL: string | URL | undefined;
  prepareBody?: (input: unknown, headers: Headers) => PreparedRequestBody;
}

interface MutableSnapshot<T> {
  data: T | undefined;
  error: import('./errors').RequestError | null;
  status: ResourceSnapshot<T>['status'];
  pending: boolean;
  refreshing: boolean;
}

const idleSnapshot = <T>(): MutableSnapshot<T> => ({
  data: undefined,
  error: null,
  status: 'idle',
  pending: false,
  refreshing: false,
});

function publicSnapshot<T>(snapshot: MutableSnapshot<T>): ResourceSnapshot<T> {
  return Object.freeze({ ...snapshot });
}

function normalizedCache(
  cache: FetchCache | undefined,
  method: FetchMethod,
): FetchCache {
  if (cache !== undefined) return cache;
  return method === 'GET' ? 'active' : false;
}

function equalCache(left: FetchCache, right: FetchCache): boolean {
  if (left === right) return true;
  return typeof left === 'object' && typeof right === 'object' &&
    left.scope === right.scope;
}

function equalDescriptor(
  left: FetchDescriptor,
  right: FetchDescriptor,
): boolean {
  return left.identity === right.identity &&
    left.url === right.url &&
    left.method === right.method &&
    normalizedHeaders(left.headers) === normalizedHeaders(right.headers) &&
    left.bodyIdentity === right.bodyIdentity &&
    left.transferIdentity === right.transferIdentity &&
    equalCache(left.cache, right.cache) &&
    left.schema === right.schema &&
    left.signal === right.signal;
}

class FetchEntry {
  readonly consumers = new Set<ResourceController<unknown>>();
  snapshot: MutableSnapshot<unknown> = idleSnapshot();
  hasData = false;
  cache: Exclude<FetchCache, false>;
  request: Promise<unknown> | null = null;
  controller: AbortController | null = null;
  operationId = createRequestId();
  private pendingOperationId: string | null = null;
  private generation = 0;

  constructor(
    readonly store: FetchStore,
    readonly descriptor: FetchDescriptor,
  ) {
    this.cache = descriptor.cache === false ? 'active' : descriptor.cache;
  }

  add(controller: ResourceController<unknown>): void {
    this.consumers.add(controller);
    controller.receive(this, this.snapshot);
  }

  remove(controller: ResourceController<unknown>, reason?: unknown): void {
    this.consumers.delete(controller);
    if (this.consumers.size !== 0) return;

    if (this.cache === 'active') {
      this.store.delete(this, reason);
    } else {
      this.cancelRequest(reason);
    }
  }

  cancelRequest(reason?: unknown): void {
    this.cancelDeferredStart();
    if (this.controller === null && this.request === null) return;
    // A response may notify consumers from its terminal `then` immediately
    // before the promise finalizer clears these handles. Releasing the final
    // consumer in that window must not turn a completed request into an
    // apparent browser-side cancellation.
    if (!this.snapshot.pending && !this.snapshot.refreshing) {
      this.controller = null;
      this.request = null;
      return;
    }
    this.generation++;
    this.controller?.abort(reason);
    this.controller = null;
    this.request = null;
    this.snapshot.error = null;
    this.snapshot.pending = false;
    this.snapshot.refreshing = false;
    this.snapshot.status = this.hasData ? 'success' : 'idle';
  }

  upgradeCache(cache: FetchCache): void {
    if (typeof cache === 'object') this.cache = cache;
  }

  emit(): void {
    for (const consumer of this.consumers) {
      consumer.receive(this, this.snapshot);
    }
  }

  deferStart(): void {
    if (this.pendingOperationId === null) {
      this.pendingOperationId = createRequestId();
      this.operationId = this.pendingOperationId;
      this.emit();
    }
  }

  cancelDeferredStart(): void {
    this.store.deferredStarts.delete(this);
    this.pendingOperationId = null;
  }

  start(force = false): Promise<unknown> {
    if (this.request !== null) return this.request;
    if (!force && this.hasData) {
      return Promise.resolve(this.snapshot.data);
    }

    const generation = ++this.generation;
    this.store.deferredStarts.delete(this);
    this.operationId = this.pendingOperationId ?? createRequestId();
    this.pendingOperationId = null;
    const controller = new AbortController();
    this.controller = controller;
    this.snapshot.error = null;
    this.snapshot.pending = true;
    this.snapshot.refreshing = this.hasData;
    this.snapshot.status = this.hasData ? 'success' : 'pending';
    this.emit();

    const request = abortable(
      () => this.store.environment.fetch()(this.descriptor.url, {
          method: this.descriptor.method,
          headers: this.descriptor.headers,
          body: this.descriptor.body,
          signal: controller.signal,
        }),
      controller.signal,
    )
      .then(response => abortable(
        () => decodeResponse(response, this.descriptor.schema),
        controller.signal,
      ))
      .then(
        data => {
          if (generation !== this.generation) return data;
          this.snapshot = {
            data,
            error: null,
            status: 'success',
            pending: false,
            refreshing: false,
          };
          this.hasData = true;
          this.emit();
          return data;
        },
        error => {
          if (generation !== this.generation) throw error;
          if (controller.signal.aborted || isAbortError(error)) {
            this.snapshot.pending = false;
            this.snapshot.refreshing = false;
            this.snapshot.status = this.hasData ? 'success' : 'idle';
            this.emit();
            throw error;
          }
          this.snapshot.error = toRequestError(error);
          this.snapshot.pending = false;
          this.snapshot.refreshing = false;
          this.snapshot.status = this.hasData ? 'success' : 'error';
          this.emit();
          throw this.snapshot.error;
        },
      )
      .finally(() => {
        if (generation === this.generation) {
          this.request = null;
          this.controller = null;
        }
      });

    this.request = request;
    request.catch(() => {});
    return request;
  }

  dispose(resetConsumers = false, reason?: unknown): void {
    this.cancelRequest(reason);
    for (const consumer of [...this.consumers]) {
      consumer.detachFrom(this, resetConsumers);
    }
    this.consumers.clear();
  }
}

/**
 * Apply a restored record to a freshly acquired entry. Success restores as
 * committed (no duplicate request), error restores its local Error branch,
 * pending restores paused until an explicit refresh (RFC §16.6.6–16.6.8).
 */
function seedEntryFromRecord(
  entry: FetchEntry,
  record: SerializedSourceRecord,
): void {
  const { snapshot } = record;
  if (snapshot.status === 'success') {
    entry.snapshot = {
      data: snapshot.data,
      error: null,
      status: 'success',
      pending: false,
      refreshing: snapshot.revalidate,
    };
    entry.hasData = true;
    return;
  }
  if (snapshot.status === 'error') {
    entry.snapshot = {
      data: undefined,
      error: new RequestError(snapshot.error.message, {
        kind: snapshot.error.kind as RequestErrorKind,
        status: snapshot.error.status ?? undefined,
        statusText: snapshot.error.statusText ?? undefined,
      }),
      status: 'error',
      pending: false,
      refreshing: false,
    };
    return;
  }
  entry.snapshot = {
    data: undefined,
    error: null,
    status: 'pending',
    pending: true,
    refreshing: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRANSFER_ERROR_KINDS = new Set<RequestErrorKind>([
  'network',
  'http',
  'decode',
  'validation',
]);

function isSerializedSnapshot(value: unknown): value is SerializedSourceSnapshot {
  if (!isRecord(value)) return false;
  if (value.status === 'pending') return true;
  if (value.status === 'success') {
    return typeof value.revalidate === 'boolean' && Object.hasOwn(value, 'data');
  }
  if (value.status !== 'error' || !isRecord(value.error)) return false;
  return typeof value.error.kind === 'string' &&
    TRANSFER_ERROR_KINDS.has(value.error.kind as RequestErrorKind) &&
    (value.error.status === null || typeof value.error.status === 'number') &&
    (value.error.statusText === null || typeof value.error.statusText === 'string') &&
    typeof value.error.message === 'string';
}

function isSerializedSourceRecord(value: unknown): value is SerializedSourceRecord {
  if (!isRecord(value)) return false;
  return typeof value.sourceId === 'string' &&
    value.sourceId.length > 0 &&
    typeof value.contractId === 'string' &&
    value.contractId.startsWith('mmd-fetch/v1:') &&
    value.requestFingerprint === value.sourceId &&
    isSerializedSnapshot(value.snapshot);
}

export class FetchStore {
  readonly entries = new Map<string, FetchEntry>();
  readonly allEntries = new Set<FetchEntry>();
  /**
   * Dormant restore records installed by `restoreState` (RFC §16.7). The
   * next acquire with a matching identity claims its record instead of
   * issuing a duplicate network request.
   */
  private restoreRecords = new Map<string, SerializedSourceRecord>();
  private hydrationBlocked = false;
  readonly deferredStarts = new Set<FetchEntry>();

  constructor(readonly environment: FetchEnvironment) {}

  installRestoreRecords(state: SerializedDataState): void {
    if (!isRecord(state)) {
      throw new TypeError('Serialized data state must be an object');
    }
    const version: unknown = state.formatVersion;
    if (version !== 1) {
      throw new TypeError(
        `Unsupported serialized data state format: ${String(version)}`,
      );
    }
    const sources: unknown = state.sources;
    if (!Array.isArray(sources)) {
      throw new TypeError('Serialized data state sources must be an array');
    }
    for (const record of sources) {
      if (isSerializedSourceRecord(record)) {
        this.restoreRecords.set(record.sourceId, record);
      }
    }
  }

  delete(entry: FetchEntry, reason?: unknown): void {
    if (this.entries.get(entry.descriptor.identity) === entry) {
      this.entries.delete(entry.descriptor.identity);
    }
    this.allEntries.delete(entry);
    this.deferredStarts.delete(entry);
    entry.dispose(false, reason);
  }

  private takeRestoreRecord(
    identity: string | null,
    contractId: string,
  ): SerializedSourceRecord | undefined {
    if (identity === null) return undefined;
    const record = this.restoreRecords.get(identity);
    if (record === undefined || record.contractId !== contractId) return undefined;
    this.restoreRecords.delete(identity);
    return record;
  }

  acquire(
    descriptor: FetchDescriptor,
    consumer: ResourceController<unknown>,
    force = false,
    replace = false,
  ): FetchEntry {
    let entry: FetchEntry;
    if (descriptor.cache === false) {
      entry = new FetchEntry(this, descriptor);
      this.allEntries.add(entry);
    } else {
      const existing = replace
        ? undefined
        : this.entries.get(descriptor.identity);
      if (existing === undefined) {
        entry = new FetchEntry(this, descriptor);
        this.allEntries.add(entry);
      } else {
        entry = existing;
      }
      this.entries.set(descriptor.identity, entry);
      entry.upgradeCache(descriptor.cache);
    }

    entry.add(consumer);
    const restored = this.takeRestoreRecord(
      descriptor.transferIdentity,
      fetchTransferContract(descriptor.schema),
    );
    if (restored !== undefined) {
      seedEntryFromRecord(entry, restored);
      entry.emit();
    }
    // A seeded entry resumes only through an explicit refresh — a restored
    // success must not re-issue its request (RFC §16.6.6) and a restored
    // error retries only through its restored source handle (§16.6.8).
    // Restored pending entries (e.g. from SSR shell streaming) start their
    // client-side fetch immediately so the in-flight server request resolves.
    const shouldStart =
      force ||
      (restored === undefined &&
        (entry.snapshot.status === 'idle' ||
          entry.snapshot.status === 'error')) ||
      (restored !== undefined &&
        (restored.snapshot.status === 'pending' ||
          (restored.snapshot.status === 'success' && restored.snapshot.revalidate)));
    if (getActiveEnvironment().mode === 'hydrate') {
      this.hydrationBlocked = true;
      if (shouldStart) {
        entry.deferStart();
        this.deferredStarts.add(entry);
      }
    } else if (shouldStart) {
      entry.start(force).catch(() => {});
    }
    return entry;
  }

  resumeHydration(): void {
    if (!this.hydrationBlocked) return;
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      this.deferredStarts.delete(entry);
      if (entry.request === null) entry.start(true).catch(() => {});
    }
  }

  cancelHydration(): void {
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      entry.cancelDeferredStart();
    }
  }

  readonly settleTimeoutMs = 5000;

  *pending(): Iterable<Promise<unknown>> {
    for (const entry of this.allEntries) {
      if (entry.request !== null) yield entry.request;
    }
  }

  clear(): void {
    for (const entry of [...this.allEntries]) entry.dispose(true);
    this.entries.clear();
    this.allEntries.clear();
    this.restoreRecords.clear();
    this.deferredStarts.clear();
    this.hydrationBlocked = false;
  }
}

class ResourceController<T> {
  snapshot: MutableSnapshot<T> = idleSnapshot();
  entry: FetchEntry | null = null;
  disposed = false;
  private removeSignalListener: (() => void) | null = null;
  readonly notifier = new SnapshotNotifier(() => publicSnapshot(this.snapshot));
  operationId = createRequestId();

  constructor(
    readonly store: FetchStore,
    descriptor: FetchDescriptor,
    paused = false,
  ) {
    this.descriptor = descriptor;
    this.paused = paused;
    if (!this.bindSignal(descriptor.signal)) return;
    if (!paused) this.attach(false);
  }

  descriptor: FetchDescriptor;
  paused: boolean;

  /** Shared by initial construction and optional request replay. */
  bindSignal(signal: AbortSignal | undefined): boolean {
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    if (signal !== undefined) {
      const abort = () => this.abort(abortReason(signal));
      if (signal.aborted) return false;
      signal.addEventListener('abort', abort, { once: true });
      this.removeSignalListener = () =>
        signal.removeEventListener('abort', abort);
    }
    return true;
  }

  attach(force: boolean, replace = false): void {
    if (this.disposed) {
      throw new Error('Cannot refresh a disposed fetch resource');
    }
    this.entry = this.store.acquire(
      this.descriptor,
      this as ResourceController<unknown>,
      force,
      replace,
    );
  }

  receive(entry: FetchEntry, snapshot: MutableSnapshot<unknown>): void {
    if (this.entry !== null && this.entry !== entry) return;
    this.operationId = entry.operationId;
    this.snapshot = { ...snapshot } as MutableSnapshot<T>;
    this.notify();
  }

  detachFrom(entry: FetchEntry, reset = false): void {
    if (this.entry !== entry) return;
    this.entry = null;
    if (reset) {
      this.snapshot = idleSnapshot();
      this.notify();
    }
  }

  notify(): void {
    this.notifier.notify();
  }

  refresh(): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('Cannot refresh a disposed fetch resource'));
    }
    if (this.paused) {
      return Promise.reject(
        new TypeError('Cannot refresh a fetch resource with a null target'),
      );
    }
    const signal = this.descriptor.signal;
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.entry === null) {
      this.operationId = createRequestId();
      this.attach(true);
    } else if (this.entry.request === null) {
      this.operationId = createRequestId();
    }
    const request = this.entry!.start(true) as Promise<T>;
    return signal === undefined
      ? request
      : abortable(() => request, signal);
  }

  abort(reason?: unknown): void {
    if (this.disposed) throw new Error('Cannot abort a disposed fetch resource');
    this.detach(true, reason);
  }

  private detach(notify: boolean, reason?: unknown): void {
    const entry = this.entry;
    if (entry !== null) {
      this.entry = null;
      entry.remove(this as ResourceController<unknown>, reason);
    }
    this.snapshot.pending = false;
    this.snapshot.refreshing = false;
    this.snapshot.status =
      this.snapshot.status === 'success' ? 'success' : 'idle';
    this.snapshot.error = null;
    if (notify) this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach(false);
    this.disposed = true;
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    this.notifier.clear();
  }
}
const controllers = getGlobalControllers() as WeakMap<object, ResourceController<unknown>>;

export function createFetchResource<T>(
  store: FetchStore,
  environment: FetchEnvironment,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 },
): FetchResource<T> {
  const { descriptor, paused } = fetchDescriptor(
    environment,
    target,
    options,
  );
  return resourceObject(new ResourceController<T>(store, descriptor, paused));
}

function fetchDescriptor(
  environment: FetchEnvironment,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 },
): { descriptor: FetchDescriptor; paused: boolean } {
  const method = normalizeFetchMethod(options.method);
  const paused=target===null;
  if (!paused && (method === 'GET' || method === 'HEAD') && options.body !== undefined) {
    throw new TypeError(`$fetch ${method} requests cannot include a body`);
  }
  const url = paused?'':resolveRequestURL(target, options.query, environment.baseURL);
  const headers = paused?options.headers:new Headers(options.headers);
  const body = paused ? undefined : options.body;
  if (body !== undefined && environment.prepareBody === undefined) {
    throw new TypeError('Request body encoding is not installed');
  }
  const preparedBody = body === undefined ? {body:undefined,identity:'none'}
    : environment.prepareBody!(body, headers as Headers);
  const descriptor: FetchDescriptor = {
    url,
    method,
    headers,
    body: preparedBody.body,
    bodyIdentity: preparedBody.identity,
    identity: paused?'paused':fetchIdentity(
      url,
      method,
      headers,
      preparedBody.identity,
      options.key,
      options.validate,
    ),
    transferIdentity: paused?null:fetchTransferIdentity(
      target,
      url,
      method,
      headers as Headers,
      preparedBody.identity,
      options.key,
      options.validate,
    ),
    cache: normalizedCache(options.cache, method),
    schema: options.validate,
    signal: options.signal,
  };
  return { descriptor, paused };
}

function resourceObject<T>(
  controller: ResourceController<T>,
): FetchResource<T> {
  const resource = {
    get data() { return controller.snapshot.data; },
    get error() { return controller.snapshot.error; },
    get status() { return controller.snapshot.status; },
    get pending() { return controller.snapshot.pending; },
    get refreshing() { return controller.snapshot.refreshing; },
    refresh: () => controller.refresh(),
    abort: () => controller.abort(),
    update: (change: (current: T | undefined) => T) =>
      dispatchResourceWrite(resource, change, false),
    mutate: (change: (current: T | undefined) => void) =>
      dispatchResourceWrite(resource, change, true),
  };
  controllers.set(resource, controller as ResourceController<unknown>);
  return resource as unknown as FetchResource<T>;
}

export function resourceController<T>(
  resource: FetchResource<T>,
): ResourceController<T> {
  const controller = controllers.get(resource);
  if (controller === undefined) {
    throw new TypeError('Value is not a fetch resource from @memoized-dom/data');
  }
  return controller as ResourceController<T>;
}

/** Internal capability check used by cross-runtime availability adapters. */
export function isFetchResource(value: unknown): value is FetchResource<unknown> {
  return typeof value === 'object' && value !== null &&
    (controllers.has(value) || isReadResource(value) || isFormSource(value));
}

export function subscribeFetchResource<T>(
  resource: FetchResource<T>,
  listener: ResourceListener<T>,
): () => void {
  if (isFormSource(resource)) {
    return subscribeFormSource(resource, listener as unknown as ResourceListener<FormSource<unknown>>);
  }
  if (isReadResource(resource)) return subscribeReadResource(resource, listener);
  const controller = resourceController(resource);
  if (controller.disposed) {
    throw new Error('Cannot subscribe to a disposed fetch resource');
  }
  return controller.notifier.subscribe(listener);
}

export function disposeFetchResource<T>(resource: FetchResource<T>): void {
  if (isFormSource(resource)) return disposeFormSource(resource);
  if (isReadResource(resource)) return disposeReadResource(resource);
  resourceController(resource).dispose();
}

/** @internal Owned holders retire with their staged component; borrowed
 * holders survive and need an explicit retry before a fresh render generation. */
export function retryFetchResourceIfLive<T>(resource: FetchResource<T>): Promise<unknown> {
  if (isFormSource(resource)) return Promise.resolve();
  if (isReadResource(resource)) {
    return readResourceIsLive(resource) ? resource.refresh() : Promise.resolve();
  }
  return resourceController(resource).disposed ? Promise.resolve() : resource.refresh();
}

/** Rebind one stable resource when compiler-tracked request inputs change. */
export function rebindFetchResource<T>(
  resource: FetchResource<T>,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 } = {},
): void {
  const controller = resourceController(resource);
  const { descriptor, paused } = fetchDescriptor(controller.store.environment, target, options);
  if (controller.disposed) {
    throw new Error('Cannot rebind a disposed fetch resource');
  }
  const unchanged =
    controller.paused === paused &&
    equalDescriptor(controller.descriptor, descriptor);
  if (unchanged) return;

  controller.operationId = createRequestId();

  const replaceSharedIdentity =
    !paused &&
    controller.descriptor.identity === descriptor.identity;
  const previous = controller.entry;
  if (previous !== null) {
    controller.entry = null;
    previous.remove(controller as ResourceController<unknown>);
  }
  controller.descriptor = descriptor;
  controller.paused = paused;
  controller.snapshot = idleSnapshot();

  if (!controller.bindSignal(descriptor.signal) || paused) {
    controller.notify();
    return;
  }
  controller.attach(false, replaceSharedIdentity);
}

/**
 * Move a freshly-created source behind this stable public resource. Imported
 * colorless factories own their argument-to-request mapping, so compiler
 * replay adopts their result instead of interpreting those arguments as a
 * raw fetch URL and options tuple.
 */
export function rebindFetchResourceFrom<T>(
  resource: FetchResource<T>,
  candidate: FetchResource<T>,
): void {
  if (isReadResource(resource) && isReadResource(candidate)) {
    adoptReadResource(resource, candidate);
    return;
  }
  const controller = resourceController(resource);
  const incoming = resourceController(candidate);
  if (incoming === controller) return;
  if (controller.disposed || incoming.disposed) {
    throw new Error('Cannot rebind a disposed fetch resource');
  }
  if (incoming.store !== controller.store) {
    incoming.dispose();
    throw new TypeError('Cannot rebind fetch resources from different data runtimes');
  }

  const unchanged =
    controller.paused === incoming.paused &&
    equalDescriptor(controller.descriptor, incoming.descriptor);
  if (unchanged) {
    incoming.dispose();
    return;
  }

  controller.operationId = incoming.operationId;

  const previous = controller.entry;
  if (previous !== null) {
    controller.entry = null;
    previous.remove(controller as ResourceController<unknown>);
  }
  controller.descriptor = incoming.descriptor;
  controller.paused = incoming.paused;
  controller.snapshot = idleSnapshot();

  if (!controller.bindSignal(controller.descriptor.signal) || controller.paused) {
    incoming.dispose();
    controller.notify();
    return;
  }

  const next = incoming.entry;
  if (next === null) {
    incoming.dispose();
    controller.notify();
    return;
  }

  // Attach the stable consumer before removing the temporary one. This is
  // essential for cache:false requests: dropping the last consumer aborts
  // the in-flight request.
  controller.entry = next;
  next.add(controller as ResourceController<unknown>);
  next.remove(incoming as ResourceController<unknown>);
  incoming.entry = null;
  incoming.dispose();
}

export function fetchResourceSnapshot<T>(
  resource: FetchResource<T>,
): ResourceSnapshot<T> {
  if (isFormSource(resource)) return formSourceSnapshot(resource) as ResourceSnapshot<T>;
  if (isReadResource(resource)) return readResourceSnapshot(resource);
  return publicSnapshot(resourceController(resource).snapshot);
}

/** Identity of the current execution behind one hidden fetch resource. */
export function fetchResourceOperationId<T>(
  resource: FetchResource<T>,
): string {
  if (isFormSource(resource)) return formSourceOperationId(resource);
  if (isReadResource(resource)) return readResourceOperationId(resource);
  return resourceController(resource).operationId;
}

export function createFetchEnvironment(
  fetcher: typeof globalThis.fetch | undefined,
  baseURL: string | URL | undefined,
): FetchEnvironment {
  const resolvedBaseURL = baseURL ?? (
    typeof location === 'undefined' ? undefined : location.href
  );
  return {
    baseURL: resolvedBaseURL,
    fetch() {
      const implementation = fetcher ?? globalThis.fetch;
      if (implementation === undefined) {
        throw new Error('No fetch implementation is available');
      }
      return implementation;
    },
  };
}

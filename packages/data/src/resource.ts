import { isAbortError, toRequestError } from './errors';
import { createOptimisticChange } from './optimistic';
import {
  decodeResponse,
  fetchIdentity,
  resolveRequestURL,
} from './request';
import type {
  FetchCache,
  FetchOptions,
  FetchResource,
  OptimisticChange,
  ResourceListener,
  ResourceSnapshot,
  StandardSchemaV1,
} from './types';

interface FetchDescriptor {
  readonly url: string;
  readonly headers: HeadersInit | undefined;
  readonly identity: string;
  readonly cache: FetchCache;
  readonly schema: StandardSchemaV1 | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface FetchEnvironment {
  readonly fetch: () => typeof globalThis.fetch;
  readonly baseURL: string | URL | undefined;
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
  return { ...snapshot };
}

function normalizedCache(cache: FetchCache | undefined): FetchCache {
  return cache ?? 'active';
}

class FetchEntry {
  readonly consumers = new Set<ResourceController<unknown>>();
  snapshot: MutableSnapshot<unknown> = idleSnapshot();
  hasData = false;
  cache: Exclude<FetchCache, false>;
  request: Promise<unknown> | null = null;
  controller: AbortController | null = null;
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

  remove(controller: ResourceController<unknown>): void {
    this.consumers.delete(controller);
    if (this.consumers.size !== 0) return;

    this.controller?.abort();
    if (this.cache === 'active') {
      this.store.delete(this);
    }
  }

  upgradeCache(cache: FetchCache): void {
    if (typeof cache === 'object') this.cache = cache;
  }

  emit(): void {
    for (const consumer of this.consumers) {
      consumer.receive(this, this.snapshot);
    }
  }

  update<T>(change: (current: T | undefined) => T): void {
    const current = this.snapshot.data as T | undefined;
    this.snapshot.data = change(current);
    this.snapshot.error = null;
    this.snapshot.status = 'success';
    this.hasData = true;
    this.emit();
  }

  mutate<T>(change: (current: T | undefined) => void): void {
    const current = this.snapshot.data as T | undefined;
    change(current);
    this.snapshot.data = current;
    this.snapshot.error = null;
    this.snapshot.status = 'success';
    this.hasData = true;
    this.emit();
  }

  start(force = false): Promise<unknown> {
    if (this.request !== null) return this.request;
    if (!force && this.hasData) {
      return Promise.resolve(this.snapshot.data);
    }

    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.snapshot.error = null;
    this.snapshot.pending = true;
    this.snapshot.refreshing = this.hasData;
    this.snapshot.status = this.hasData ? 'success' : 'pending';
    this.emit();

    const request = Promise.resolve()
      .then(() =>
        this.store.environment.fetch()(this.descriptor.url, {
          method: 'GET',
          headers: this.descriptor.headers,
          signal: controller.signal,
        }),
      )
      .then(response => decodeResponse(response, this.descriptor.schema))
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
          if (isAbortError(error)) {
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

  dispose(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.request = null;
    for (const consumer of [...this.consumers]) consumer.detachFrom(this);
    this.consumers.clear();
  }
}

export class FetchStore {
  readonly entries = new Map<string, FetchEntry>();
  readonly allEntries = new Set<FetchEntry>();

  constructor(readonly environment: FetchEnvironment) {}

  acquire(
    descriptor: FetchDescriptor,
    consumer: ResourceController<unknown>,
    force = false,
  ): FetchEntry {
    let entry: FetchEntry;
    if (descriptor.cache === false) {
      entry = new FetchEntry(this, descriptor);
      this.allEntries.add(entry);
    } else {
      const existing = this.entries.get(descriptor.identity);
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
    const shouldStart =
      force ||
      entry.snapshot.status === 'idle' ||
      entry.snapshot.status === 'error';
    if (shouldStart) entry.start(force).catch(() => {});
    return entry;
  }

  delete(entry: FetchEntry): void {
    if (this.entries.get(entry.descriptor.identity) === entry) {
      this.entries.delete(entry.descriptor.identity);
    }
    this.allEntries.delete(entry);
    entry.dispose();
  }

  clear(): void {
    for (const entry of [...this.allEntries]) entry.dispose();
    this.entries.clear();
    this.allEntries.clear();
  }
}

class ResourceController<T> {
  readonly listeners = new Set<ResourceListener<T>>();
  snapshot: MutableSnapshot<T> = idleSnapshot();
  entry: FetchEntry | null = null;
  disposed = false;
  private removeSignalListener: (() => void) | null = null;

  constructor(
    readonly store: FetchStore,
    readonly descriptor: FetchDescriptor,
    readonly paused = false,
  ) {
    if (!paused) this.attach(false);
    const signal = descriptor.signal;
    if (signal !== undefined) {
      const abort = () => this.abort();
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        this.removeSignalListener = () =>
          signal.removeEventListener('abort', abort);
      }
    }
  }

  attach(force: boolean): void {
    if (this.disposed) {
      throw new Error('Cannot refresh a disposed fetch resource');
    }
    this.entry = this.store.acquire(
      this.descriptor,
      this as ResourceController<unknown>,
      force,
    );
  }

  receive(entry: FetchEntry, snapshot: MutableSnapshot<unknown>): void {
    if (this.entry !== null && this.entry !== entry) return;
    this.snapshot = publicSnapshot(snapshot) as MutableSnapshot<T>;
    this.notify();
  }

  detachFrom(entry: FetchEntry): void {
    if (this.entry === entry) this.entry = null;
  }

  notify(): void {
    const snapshot = publicSnapshot(this.snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }

  refresh(): Promise<T> {
    if (this.paused) {
      return Promise.reject(
        new TypeError('Cannot refresh a fetch resource with a null target'),
      );
    }
    if (this.entry === null) this.attach(true);
    return this.entry!.start(true) as Promise<T>;
  }

  abort(): void {
    const entry = this.entry;
    if (entry !== null) {
      this.entry = null;
      entry.remove(this as ResourceController<unknown>);
    }
    this.snapshot.pending = false;
    this.snapshot.refreshing = false;
    this.snapshot.status =
      this.snapshot.status === 'success' ? 'success' : 'idle';
    this.snapshot.error = null;
    this.notify();
  }

  update(change: (current: T | undefined) => T): void {
    if (this.entry === null) {
      const current = this.snapshot.data;
      this.snapshot.data = change(current);
      this.snapshot.status = 'success';
      this.snapshot.error = null;
      this.notify();
      return;
    }
    this.entry.update(change);
  }

  mutate(change: (current: T | undefined) => void): void {
    if (this.entry === null) {
      change(this.snapshot.data);
      this.snapshot.status = 'success';
      this.snapshot.error = null;
      this.notify();
      return;
    }
    this.entry.mutate(change);
  }

  dispose(): void {
    if (this.disposed) return;
    this.abort();
    this.disposed = true;
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    this.listeners.clear();
  }
}

const controllers = new WeakMap<object, ResourceController<unknown>>();

function collection<T>(controller: ResourceController<T[]>): T[] {
  return Array.isArray(controller.snapshot.data)
    ? controller.snapshot.data
    : [];
}

function appendChange<T>(
  controller: ResourceController<T[]>,
  temporary: T,
): OptimisticChange<T> {
  controller.update(current => [...(current ?? []), temporary]);
  return createOptimisticChange({
    rollback() {
      controller.update(current => {
        const next = [...(current ?? [])];
        const index = next.indexOf(temporary);
        if (index !== -1) next.splice(index, 1);
        return next;
      });
    },
    commit(result) {
      controller.update(current => {
        const next = [...(current ?? [])];
        const index = next.indexOf(temporary);
        if (index !== -1) next[index] = result;
        return next;
      });
    },
  });
}

function replaceChange<T>(
  controller: ResourceController<T[]>,
  current: T,
  temporary: T,
): OptimisticChange<T> {
  controller.update(items =>
    (items ?? []).map(item => item === current ? temporary : item),
  );
  return createOptimisticChange({
    rollback() {
      controller.update(items => {
        const next = [...(items ?? [])];
        const index = next.indexOf(temporary);
        if (index !== -1) next[index] = current;
        return next;
      });
    },
    commit(result) {
      controller.update(items => {
        const next = [...(items ?? [])];
        const index = next.indexOf(temporary);
        if (index !== -1) next[index] = result;
        return next;
      });
    },
  });
}

function removeChange<T, TResult>(
  controller: ResourceController<T[]>,
  current: T,
): OptimisticChange<TResult> {
  const index = collection(controller).indexOf(current);
  controller.update(items => (items ?? []).filter(item => item !== current));
  return createOptimisticChange<TResult>({
    rollback() {
      controller.update(items => {
        const next = [...(items ?? [])];
        if (!next.includes(current)) {
          next.splice(Math.min(Math.max(index, 0), next.length), 0, current);
        }
        return next;
      });
    },
    commit() {},
  });
}

export function createFetchResource<T>(
  store: FetchStore,
  environment: FetchEnvironment,
  target: string | URL | null,
  options: FetchOptions & { readonly validate?: StandardSchemaV1 },
): FetchResource<T> {
  if (target === null) {
    return resourceObject(
      new ResourceController<T>(
        store,
        {
          url: '',
          headers: options.headers,
          identity: 'paused',
          cache: normalizedCache(options.cache),
          schema: options.validate,
          signal: options.signal,
        },
        true,
      ),
    );
  }

  const url = resolveRequestURL(target, options.query, environment.baseURL);
  const descriptor: FetchDescriptor = {
    url,
    headers: options.headers,
    identity: fetchIdentity(url, options.headers, options.key, options.validate),
    cache: normalizedCache(options.cache),
    schema: options.validate,
    signal: options.signal,
  };
  return resourceObject(new ResourceController<T>(store, descriptor));
}

function resourceObject<T>(
  controller: ResourceController<T>,
): FetchResource<T> {
  const collectionController =
    controller as unknown as ResourceController<unknown[]>;
  const resource = {
    get data() { return controller.snapshot.data; },
    get error() { return controller.snapshot.error; },
    get status() { return controller.snapshot.status; },
    get pending() { return controller.snapshot.pending; },
    get refreshing() { return controller.snapshot.refreshing; },
    refresh: () => controller.refresh(),
    abort: () => controller.abort(),
    update: (change: (current: T | undefined) => T) =>
      controller.update(change),
    mutate: (change: (current: T | undefined) => void) =>
      controller.mutate(change),
    append: (temporary: unknown) =>
      appendChange(collectionController, temporary),
    replace: (current: unknown, temporary: unknown) =>
      replaceChange(
        collectionController,
        current,
        temporary,
      ),
    remove: <TResult>(current: unknown) =>
      removeChange<unknown, TResult>(
        collectionController,
        current,
      ),
  };
  controllers.set(resource, controller as ResourceController<unknown>);
  return resource as unknown as FetchResource<T>;
}

function resourceController<T>(
  resource: FetchResource<T>,
): ResourceController<T> {
  const controller = controllers.get(resource);
  if (controller === undefined) {
    throw new TypeError('Value is not a fetch resource from @memoized-dom/data');
  }
  return controller as ResourceController<T>;
}

export function subscribeFetchResource<T>(
  resource: FetchResource<T>,
  listener: ResourceListener<T>,
): () => void {
  const controller = resourceController(resource);
  controller.listeners.add(listener);
  listener(publicSnapshot(controller.snapshot));
  return () => controller.listeners.delete(listener);
}

export function disposeFetchResource<T>(resource: FetchResource<T>): void {
  resourceController(resource).dispose();
}

export function fetchResourceSnapshot<T>(
  resource: FetchResource<T>,
): ResourceSnapshot<T> {
  return publicSnapshot(resourceController(resource).snapshot);
}

export function createFetchEnvironment(
  fetcher: typeof globalThis.fetch | undefined,
  baseURL: string | URL | undefined,
): FetchEnvironment {
  return {
    baseURL,
    fetch() {
      const implementation = fetcher ?? globalThis.fetch;
      if (implementation === undefined) {
        throw new Error('No fetch implementation is available');
      }
      return implementation;
    },
  };
}

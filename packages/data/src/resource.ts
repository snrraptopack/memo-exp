import { isAbortError, toRequestError } from './errors';
import { SnapshotNotifier } from './notifications';
import { createOptimisticChange } from './optimistic';
import {
  abortable,
  abortReason,
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
  return Object.freeze({ ...snapshot });
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

  remove(controller: ResourceController<unknown>, reason?: unknown): void {
    this.consumers.delete(controller);
    if (this.consumers.size !== 0) return;

    if (this.cache === 'active') {
      this.store.delete(this, reason);
    } else {
      this.cancelRequest(reason);
    }
  }

  private cancelRequest(reason?: unknown): void {
    if (this.controller === null && this.request === null) return;
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

  update<T>(change: (current: T | undefined) => T): void {
    const current = this.snapshot.data as T | undefined;
    const next = change(current);
    // A caller-authored write is newer than any read already in flight. Abort
    // that flight before publishing the replacement so a non-cooperative
    // fetcher cannot later commit an older server snapshot over local state.
    this.cancelRequest();
    this.snapshot.data = next;
    this.snapshot.error = null;
    this.snapshot.status = 'success';
    this.hasData = true;
    this.emit();
  }

  mutate<T>(change: (current: T | undefined) => void): void {
    const current = this.snapshot.data as T | undefined;
    change(current);
    // Direct mutations have the same ordering contract as replacements: the
    // local write wins over a read that started before it.
    this.cancelRequest();
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

    const request = abortable(
      () => this.store.environment.fetch()(this.descriptor.url, {
          method: 'GET',
          headers: this.descriptor.headers,
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

  delete(entry: FetchEntry, reason?: unknown): void {
    if (this.entries.get(entry.descriptor.identity) === entry) {
      this.entries.delete(entry.descriptor.identity);
    }
    this.allEntries.delete(entry);
    entry.dispose(false, reason);
  }

  clear(): void {
    for (const entry of [...this.allEntries]) entry.dispose(true);
    this.entries.clear();
    this.allEntries.clear();
  }
}

class ResourceController<T> {
  snapshot: MutableSnapshot<T> = idleSnapshot();
  entry: FetchEntry | null = null;
  disposed = false;
  private removeSignalListener: (() => void) | null = null;
  readonly notifier = new SnapshotNotifier(() => publicSnapshot(this.snapshot));

  constructor(
    readonly store: FetchStore,
    readonly descriptor: FetchDescriptor,
    readonly paused = false,
  ) {
    const signal = descriptor.signal;
    if (signal !== undefined) {
      const abort = () => this.abort(abortReason(signal));
      if (signal.aborted) return;
      else {
        signal.addEventListener('abort', abort, { once: true });
        this.removeSignalListener = () =>
          signal.removeEventListener('abort', abort);
      }
    }
    if (!paused) this.attach(false);
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
    if (this.entry === null) this.attach(true);
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

  update(change: (current: T | undefined) => T): void {
    if (this.disposed) throw new Error('Cannot update a disposed fetch resource');
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
    if (this.disposed) throw new Error('Cannot mutate a disposed fetch resource');
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
    this.detach(false);
    this.disposed = true;
    this.removeSignalListener?.();
    this.removeSignalListener = null;
    this.notifier.clear();
  }
}

const controllers = new WeakMap<object, ResourceController<unknown>>();

function collection<T>(controller: ResourceController<T[]>): T[] {
  return Array.isArray(controller.snapshot.data)
    ? controller.snapshot.data
    : [];
}

interface ReplacementStep<T> {
  readonly temporary: T;
  outcome: 'pending' | 'committed' | 'rolled-back';
  result?: T;
}

interface ReplacementChain<T> {
  readonly index: number;
  readonly base: T;
  readonly steps: ReplacementStep<T>[];
  visible: T;
}

const replacementChains = new WeakMap<object, Set<ReplacementChain<unknown>>>();

function chainsFor<T>(
  controller: ResourceController<T[]>,
): Set<ReplacementChain<T>> {
  let chains = replacementChains.get(controller);
  if (chains === undefined) {
    chains = new Set();
    replacementChains.set(controller, chains);
  }
  return chains as Set<ReplacementChain<T>>;
}

function replacementTarget<T>(
  items: readonly T[],
  chain: ReplacementChain<T>,
  visible: T,
): number {
  if (Object.is(items[chain.index], visible)) return chain.index;
  let target = -1;
  for (let index = 0; index < items.length; index++) {
    if (!Object.is(items[index], visible)) continue;
    if (target !== -1) return -1;
    target = index;
  }
  return target;
}

function settleReplacement<T>(
  controller: ResourceController<T[]>,
  chain: ReplacementChain<T>,
  step: ReplacementStep<T>,
  outcome: 'committed' | 'rolled-back',
  result?: T,
): void {
  step.outcome = outcome;
  step.result = result;

  let visible = chain.base;
  for (const current of chain.steps) {
    if (current.outcome === 'pending') visible = current.temporary;
    else if (current.outcome === 'committed') visible = current.result as T;
  }

  const previous = chain.visible;
  chain.visible = visible;
  if (!Object.is(previous, visible)) {
    controller.update(items => {
      const next = [...(items ?? [])];
      const target = replacementTarget(next, chain, previous);
      if (target !== -1) next[target] = visible;
      return next;
    });
  }

  if (chain.steps.every(current => current.outcome !== 'pending')) {
    chainsFor(controller).delete(chain);
  }
}

function appendChange<T>(
  controller: ResourceController<T[]>,
  temporary: T,
): OptimisticChange<T> {
  const index = collection(controller).length;
  controller.update(current => [...(current ?? []), temporary]);
  return createOptimisticChange({
    rollback() {
      controller.update(current => {
        const next = [...(current ?? [])];
        const target = next[index] === temporary
          ? index
          : next.lastIndexOf(temporary);
        if (target !== -1) next.splice(target, 1);
        return next;
      });
    },
    commit(result) {
      controller.update(current => {
        const next = [...(current ?? [])];
        const target = next[index] === temporary
          ? index
          : next.lastIndexOf(temporary);
        if (target !== -1) next[target] = result;
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
  const items = collection(controller);
  const index = items.indexOf(current);
  if (index === -1) {
    return createOptimisticChange({ rollback() {}, commit() {} });
  }
  const chains = chainsFor(controller);
  let chain = [...chains].find(candidate =>
    Object.is(candidate.visible, current) &&
    replacementTarget(items, candidate, current) === index
  );
  if (chain === undefined) {
    chain = { index, base: current, visible: current, steps: [] };
    chains.add(chain);
  }
  const step: ReplacementStep<T> = {
    temporary,
    outcome: 'pending',
  };
  chain.steps.push(step);
  chain.visible = temporary;
  controller.update(values =>
    (values ?? []).map((item, itemIndex) =>
      itemIndex === index ? temporary : item
    ),
  );
  return createOptimisticChange({
    rollback() {
      settleReplacement(controller, chain, step, 'rolled-back');
    },
    commit(result) {
      settleReplacement(controller, chain, step, 'committed', result);
    },
  });
}

function removeChange<T, TResult>(
  controller: ResourceController<T[]>,
  current: T,
): OptimisticChange<TResult> {
  const index = collection(controller).indexOf(current);
  if (index === -1) {
    return createOptimisticChange<TResult>({ rollback() {}, commit() {} });
  }
  controller.update(items => {
    const next = [...(items ?? [])];
    if (next[index] === current) next.splice(index, 1);
    return next;
  });
  return createOptimisticChange<TResult>({
    rollback() {
      controller.update(items => {
        const next = [...(items ?? [])];
        next.splice(Math.min(index, next.length), 0, current);
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
  const headers = new Headers(options.headers);
  const descriptor: FetchDescriptor = {
    url,
    headers,
    identity: fetchIdentity(url, headers, options.key, options.validate),
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
  if (controller.disposed) {
    throw new Error('Cannot subscribe to a disposed fetch resource');
  }
  return controller.notifier.subscribe(listener);
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

import { RequestError } from './errors';
import { SnapshotNotifier } from './notifications';
import type { FetchResource, ResourceListener, ResourceSnapshot } from './types';

let nextReadId = 1;

function readError(cause: unknown): RequestError {
  if (cause instanceof RequestError) return cause;
  return new RequestError(
    cause instanceof Error ? cause.message : String(cause),
    { kind: 'promise', cause },
  );
}

export class ReadStore {
  readonly controllers = new Set<ReadController<unknown>>();
  readonly active = new Set<Promise<unknown>>();

  clear(): void {
    for (const controller of [...this.controllers]) controller.dispose();
    this.active.clear();
  }

  async settle(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        Promise.allSettled([...this.active]).then(() => true),
        new Promise<false>(resolve => {
          timer = setTimeout(() => resolve(false), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      if (!settled) return false;
    }
    return true;
  }
}

class ReadController<T> {
  readonly notifier = new SnapshotNotifier<ResourceSnapshot<T>>(() => this.snapshot());
  readonly store: ReadStore;
  operationId = `read-${nextReadId++}`;
  disposed = false;
  status: ResourceSnapshot<T>['status'] = 'pending';
  data: T | undefined;
  error: RequestError | null = null;
  pending = true;
  refreshing = false;
  generation = 0;
  promise: PromiseLike<T>;
  replay: (() => PromiseLike<T>) | undefined;

  constructor(store: ReadStore, promise: PromiseLike<T>, replay?: () => PromiseLike<T>) {
    this.store = store;
    this.promise = promise;
    this.replay = replay;
    store.controllers.add(this as ReadController<unknown>);
    void this.observe(promise, this.generation);
  }

  snapshot(): ResourceSnapshot<T> {
    return Object.freeze({
      data: this.data,
      error: this.error,
      status: this.status,
      pending: this.pending,
      refreshing: this.refreshing,
    });
  }

  private observe(promise: PromiseLike<T>, generation: number): Promise<T> {
    const work = Promise.resolve(promise).then(
      result => {
        if (!this.disposed && generation === this.generation) {
          this.data = result;
          this.status = 'success';
          this.pending = false;
          this.refreshing = false;
          this.error = null;
          this.notifier.notify();
        }
        return result;
      },
      cause => {
        const error = readError(cause);
        if (!this.disposed && generation === this.generation) {
          this.status = 'error';
          this.pending = false;
          this.refreshing = false;
          this.error = error;
          this.notifier.notify();
        }
        throw error;
      },
    );
    this.store.active.add(work);
    void work.finally(() => this.store.active.delete(work)).catch(() => {});
    void work.catch(() => {});
    return work;
  }

  replace(promise: PromiseLike<T>, replay = this.replay): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Cannot rebind a disposed read source'));
    this.generation++;
    this.operationId = `read-${nextReadId++}`;
    this.promise = promise;
    this.replay = replay;
    this.refreshing = this.status === 'success';
    this.pending = !this.refreshing;
    if (!this.refreshing) this.status = 'pending';
    this.error = null;
    this.notifier.notify();
    return this.observe(promise, this.generation);
  }

  refresh(): Promise<T> {
    if (this.replay === undefined) {
      return Promise.reject(new TypeError('This read source has no replay operation'));
    }
    try {
      return this.replace(this.replay());
    } catch (cause) {
      return this.replace(Promise.reject(cause));
    }
  }

  abort(): void {
    // Observing a promise does not grant cancellation of its underlying work.
  }

  update(change: (current: T | undefined) => T): void {
    if (this.disposed) throw new Error('Cannot update a disposed read source');
    this.data = change(this.data);
    this.status = 'success';
    this.error = null;
    this.pending = false;
    this.notifier.notify();
  }

  mutate(change: (current: T | undefined) => void): void {
    if (this.disposed) throw new Error('Cannot mutate a disposed read source');
    change(this.data);
    this.status = 'success';
    this.error = null;
    this.pending = false;
    this.notifier.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.store.controllers.delete(this as ReadController<unknown>);
    this.notifier.clear();
  }
}

const controllers = new WeakMap<object, ReadController<unknown>>();

function controller<T>(resource: FetchResource<T>): ReadController<T> {
  const found = controllers.get(resource);
  if (found === undefined) throw new TypeError('Not a read source');
  return found as ReadController<T>;
}

export function isReadResource(value: unknown): boolean {
  return typeof value === 'object' && value !== null && controllers.has(value);
}

export function createReadResource<T>(
  store: ReadStore,
  promise: PromiseLike<T>,
  replay?: () => PromiseLike<T>,
): FetchResource<T> {
  const state = new ReadController(store, promise, replay);
  const resource = Object.freeze({
    get data() { return state.data; },
    get error() { return state.error; },
    get status() { return state.status; },
    get pending() { return state.pending; },
    get refreshing() { return state.refreshing; },
    refresh: () => state.refresh(),
    abort: () => state.abort(),
    update: (change: (current: T | undefined) => T) => state.update(change),
    mutate: (change: (current: T | undefined) => void) => state.mutate(change),
  }) as FetchResource<T>;
  controllers.set(resource, state as ReadController<unknown>);
  return resource;
}

export function readResourceSnapshot<T>(resource: FetchResource<T>): ResourceSnapshot<T> {
  return controller(resource).snapshot();
}

export function readResourceOperationId<T>(resource: FetchResource<T>): string {
  return controller(resource).operationId;
}

export function subscribeReadResource<T>(
  resource: FetchResource<T>,
  listener: ResourceListener<T>,
): () => void {
  return controller(resource).notifier.subscribe(listener);
}

export function disposeReadResource<T>(resource: FetchResource<T>): void {
  controller(resource).dispose();
}

export function readResourceIsLive<T>(resource: FetchResource<T>): boolean {
  return !controller(resource).disposed;
}

export function rebindReadResource<T>(
  resource: FetchResource<T>,
  promise: PromiseLike<T>,
  replay?: () => PromiseLike<T>,
): void {
  void controller(resource).replace(promise, replay).catch(() => {});
}

export function adoptReadResource<T>(
  resource: FetchResource<T>,
  candidate: FetchResource<T>,
): void {
  const source = controller(candidate);
  void controller(resource).replace(source.promise, source.replay).catch(() => {});
  source.dispose();
}

export type RouteHistoryAction = 'push' | 'replace' | 'pop';

export interface RouteHistoryLocation {
  readonly key: string;
  readonly index: number;
  readonly href: string;
  readonly state: unknown;
}

export interface RouteHistoryUpdate {
  readonly action: RouteHistoryAction;
  readonly location: RouteHistoryLocation;
}

export type RouteHistoryListener = (update: RouteHistoryUpdate) => void;

/** @internal Marks an observer error that happened after router state committed. */
export class RouteHistoryCommittedUpdateError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('A route observer failed after the history update committed');
    this.name = 'RouteHistoryCommittedUpdateError';
    this.cause = cause;
  }
}

function rethrowHistoryError(error: unknown, rollback: () => void): never {
  if (error instanceof RouteHistoryCommittedUpdateError) throw error.cause;
  rollback();
  throw error;
}

/**
 * Synchronous storage boundary consumed by the route runtime.
 *
 * Browser adapters remain responsible for synchronizing this contract with the
 * actual address bar. The built-in memory implementation is intended for tests,
 * SSR preparation, embedded roots, and non-browser environments.
 */
export interface RouteHistory {
  readonly location: RouteHistoryLocation;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** Reads a traversal target without mutating the stack. */
  peek(delta: number): RouteHistoryLocation | undefined;
  push(href: string | URL, state?: unknown): void;
  replace(href: string | URL, state?: unknown): void;
  go(delta: number): void;
  back(): void;
  forward(): void;
  subscribe(listener: RouteHistoryListener): () => void;
  destroy(): void;
}

export interface MemoryRouteHistoryEntry {
  readonly href: string | URL;
  readonly state?: unknown;
}

export interface MemoryRouteHistoryOptions {
  readonly initialEntries?: readonly (string | URL | MemoryRouteHistoryEntry)[];
  readonly initialIndex?: number;
  readonly origin?: string | URL;
}

const MEMORY_ORIGIN = 'http://memoized-dom.local';

function entryInput(
  value: string | URL | MemoryRouteHistoryEntry,
): MemoryRouteHistoryEntry {
  return typeof value === 'string' || value instanceof URL
    ? { href: value }
    : value;
}

/** Creates an isolated, deterministic history stack with synchronous updates. */
export function createMemoryRouteHistory(
  options: MemoryRouteHistoryOptions = {},
): RouteHistory {
  const origin = new URL(options.origin ?? MEMORY_ORIGIN);
  const supplied = options.initialEntries ?? ['/'];
  if (supplied.length === 0) {
    throw new TypeError('Memory route history requires at least one initial entry');
  }

  let nextKey = 0;
  const createLocation = (
    value: string | URL | MemoryRouteHistoryEntry,
    index: number,
    retainedKey?: string,
  ): RouteHistoryLocation => {
    const input = entryInput(value);
    return Object.freeze({
      key: retainedKey ?? `memory-${nextKey++}`,
      index,
      href: new URL(input.href, origin).href,
      state: input.state ?? null,
    });
  };

  let entries = supplied.map((entry, index) => createLocation(entry, index));
  let index = options.initialIndex ?? entries.length - 1;
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
    throw new RangeError(
      `Memory route history initialIndex ${index} is outside 0..${entries.length - 1}`,
    );
  }

  let destroyed = false;
  const listeners = new Set<RouteHistoryListener>();

  function assertActive(): void {
    if (destroyed) throw new Error('Cannot use a destroyed memory route history');
  }

  function emit(action: RouteHistoryAction): void {
    const update = Object.freeze({ action, location: entries[index]! });
    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener(update);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Route history listeners failed');
  }

  function go(delta: number): void {
    assertActive();
    if (!Number.isInteger(delta)) {
      throw new TypeError('Memory route history delta must be an integer');
    }
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= entries.length || nextIndex === index) return;
    const previousIndex = index;
    index = nextIndex;
    try {
      emit('pop');
    } catch (error) {
      rethrowHistoryError(error, () => { index = previousIndex; });
    }
  }

  return {
    get location() {
      return entries[index]!;
    },
    get canGoBack() {
      return index > 0;
    },
    get canGoForward() {
      return index < entries.length - 1;
    },
    peek(delta) {
      assertActive();
      if (!Number.isInteger(delta)) {
        throw new TypeError('Memory route history delta must be an integer');
      }
      return entries[index + delta];
    },
    push(href, state = null) {
      assertActive();
      const previousEntries = entries;
      const previousIndex = index;
      const nextIndex = index + 1;
      entries = entries.slice(0, nextIndex);
      entries.push(createLocation({ href, state }, nextIndex));
      index = nextIndex;
      try {
        emit('push');
      } catch (error) {
        rethrowHistoryError(error, () => {
          entries = previousEntries;
          index = previousIndex;
        });
      }
    },
    replace(href, state = null) {
      assertActive();
      const previous = entries[index]!;
      entries[index] = createLocation({ href, state }, index, entries[index]!.key);
      try {
        emit('replace');
      } catch (error) {
        rethrowHistoryError(error, () => { entries[index] = previous; });
      }
    },
    go,
    back() {
      go(-1);
    },
    forward() {
      go(1);
    },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    },
  };
}

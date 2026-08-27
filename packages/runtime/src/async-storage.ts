export interface StorageShim<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

const GLOBAL_STORAGE_KEY = '__MMD_ASYNC_STORAGE__';

export function createStorage<T>(name = 'default'): StorageShim<T> {
  const g = globalThis as unknown as Record<string, unknown>;
  const globalRegistry = (g[GLOBAL_STORAGE_KEY] ??= new Map<string, StorageShim<unknown>>()) as Map<string, StorageShim<unknown>>;

  const existing = globalRegistry.get(name);
  if (existing !== undefined) {
    return existing as StorageShim<T>;
  }

  const isNodeOrBun =
    typeof process !== 'undefined' &&
    process.versions != null &&
    (process.versions.node != null || process.versions.bun != null);

  let storage: StorageShim<T>;

  if (isNodeOrBun) {
    try {
      const asyncHooks = globalThis.process?.getBuiltinModule?.('node:async_hooks') ??
        (typeof require === 'function' ? require('node:async_hooks') : null);
      if (asyncHooks?.AsyncLocalStorage) {
        storage = new asyncHooks.AsyncLocalStorage();
        globalRegistry.set(name, storage as StorageShim<unknown>);
        return storage;
      }
    } catch {
      // Browser or fallback
    }
  }

  let currentStore: T | undefined;
  storage = {
    getStore() {
      return currentStore;
    },
    run<R>(store: T, callback: () => R): R {
      const previous = currentStore;
      currentStore = store;
      try {
        return callback();
      } finally {
        currentStore = previous;
      }
    },
  };

  globalRegistry.set(name, storage as StorageShim<unknown>);
  return storage;
}

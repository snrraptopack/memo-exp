export interface StorageShim<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

export function createStorage<T>(): StorageShim<T> {
  const isNodeOrBun =
    typeof process !== 'undefined' &&
    process.versions != null &&
    (process.versions.node != null || process.versions.bun != null);

  if (isNodeOrBun) {
    try {
      const asyncHooks = globalThis.process?.getBuiltinModule?.('node:async_hooks') ??
        (typeof require === 'function' ? require('node:async_hooks') : null);
      if (asyncHooks?.AsyncLocalStorage) {
        return new asyncHooks.AsyncLocalStorage();
      }
    } catch {
      // Browser or unbundled fallback
    }
  }

  let currentStore: T | undefined;
  return {
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
}

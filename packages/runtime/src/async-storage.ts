export interface StorageShim<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

export type StorageFactory = <T>() => StorageShim<T>;

const GLOBAL_STORAGE_KEY = '__MMD_ASYNC_STORAGE__';
let storageFactory: StorageFactory = createSynchronousStorage;

/** Configure the host-specific scoped-storage implementation. */
export function setStorageFactory(factory: StorageFactory): void {
  storageFactory = factory;
}

function createSynchronousStorage<T>(): StorageShim<T> {
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

export function createStorage<T>(name = 'default'): StorageShim<T> {
  const g = globalThis as unknown as Record<string, unknown>;
  const globalRegistry = (g[GLOBAL_STORAGE_KEY] ??= new Map<string, StorageShim<unknown>>()) as Map<string, StorageShim<unknown>>;

  const existing = globalRegistry.get(name);
  if (existing !== undefined) {
    return existing as StorageShim<T>;
  }

  // Resolution is lazy so the explicit server entry can install
  // AsyncLocalStorage after the shared kernel module has initialized.
  let resolved: StorageShim<T> | undefined;
  const storage: StorageShim<T> = {
    getStore() {
      resolved ??= storageFactory<T>();
      return resolved.getStore();
    },
    run<R>(store: T, callback: () => R): R {
      resolved ??= storageFactory<T>();
      return resolved.run(store, callback);
    },
  };

  globalRegistry.set(name, storage as StorageShim<unknown>);
  return storage;
}

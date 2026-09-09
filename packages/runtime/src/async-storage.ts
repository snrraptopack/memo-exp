export interface StorageShim<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

export type StorageFactory = <T>() => StorageShim<T>;

const GLOBAL_STORAGE_KEY = '__MMD_ASYNC_STORAGE_V2__';

interface StorageRegistry {
  factory: StorageFactory;
  version: number;
  readonly storages: Map<string, StorageShim<unknown>>;
}

function getStorageRegistry(): StorageRegistry {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const existing = globalRecord[GLOBAL_STORAGE_KEY];
  if (existing !== undefined) return existing as StorageRegistry;
  const registry: StorageRegistry = {
    factory: createSynchronousStorage,
    version: 0,
    storages: new Map(),
  };
  globalRecord[GLOBAL_STORAGE_KEY] = registry;
  return registry;
}

/** Configure the host-specific scoped-storage implementation. */
export function setStorageFactory(factory: StorageFactory): void {
  const registry = getStorageRegistry();
  registry.factory = factory;
  registry.version++;
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
  const registry = getStorageRegistry();

  const existing = registry.storages.get(name);
  if (existing !== undefined) {
    return existing as StorageShim<T>;
  }

  // Resolution is lazy so the explicit server entry can install
  // AsyncLocalStorage after the shared kernel module has initialized.
  let resolved: StorageShim<T> | undefined;
  let resolvedVersion = -1;
  const resolve = (): StorageShim<T> => {
    if (resolved === undefined || resolvedVersion !== registry.version) {
      resolved = registry.factory<T>();
      resolvedVersion = registry.version;
    }
    return resolved;
  };
  const storage: StorageShim<T> = {
    getStore() {
      return resolve().getStore();
    },
    run<R>(store: T, callback: () => R): R {
      return resolve().run(store, callback);
    },
  };

  registry.storages.set(name, storage as StorageShim<unknown>);
  return storage;
}

import {
  clearDataRuntimeSources,
  registerDataRuntimeProvider,
  settleDataRuntimeSources,
} from './runtime-lifetime';
import {
  createFetchEnvironment,
  createFetchResource,
  FetchStore,
  type FetchEnvironment,
} from './resource';
import type {
  DataRuntime,
  DataRuntimeOptions,
  FetchFunction,
  FetchOptions,
  StandardSchemaV1,
} from './types';

export type CoreDataRuntime = Omit<DataRuntime, '$read' | 'serializeState'>;

const stores = new WeakMap<CoreDataRuntime, FetchStore>();

/** Foreign public runtimes own their fetch implementation and need no installer. */
export function installFetchBodyPreparer(
  runtime: CoreDataRuntime,
  prepare: NonNullable<FetchEnvironment['prepareBody']>,
): void {
  const store = stores.get(runtime);
  if (store !== undefined) store.environment.prepareBody = prepare;
}

export function fetchStoreForRuntime(runtime: CoreDataRuntime): FetchStore {
  const store = stores.get(runtime);
  if (store === undefined) throw new TypeError('Runtime has no fetch store');
  return store;
}

export function resumeDataHydration(runtime: CoreDataRuntime): void {
  stores.get(runtime)?.resumeHydration();
}

export function cancelDataHydration(runtime: CoreDataRuntime): void {
  stores.get(runtime)?.cancelHydration();
}

/** Create an isolated request/cache/action ownership boundary. */
export function createCoreDataRuntime(
  options: DataRuntimeOptions = {},
): CoreDataRuntime {
  const environment = createFetchEnvironment(options.fetch, options.baseURL);
  const store = new FetchStore(environment);

  const fetchResource = (<T>(
    target: string | URL | null,
    fetchOptions: FetchOptions & {
      readonly validate?: StandardSchemaV1;
    } = {},
  ) => createFetchResource<T>(
    store,
    environment,
    target,
    fetchOptions,
  )) as FetchFunction;

  const runtime: CoreDataRuntime = {
    $fetch: fetchResource,
    clear() {
      clearDataRuntimeSources(runtime);
    },
    settle(timeoutMs) {
      return settleDataRuntimeSources(runtime, timeoutMs);
    },
    restoreState(state) {
      store.installRestoreRecords(state);
    },
  };
  registerDataRuntimeProvider(runtime, store);
  stores.set(runtime, store);
  return runtime;
}

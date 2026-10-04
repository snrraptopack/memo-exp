import {
  clearDataRuntimeSources,
  registerDataRuntimeProvider,
  settleDataRuntimeSources,
} from './runtime-lifetime';
import {
  createFetchEnvironment,
  createFetchResource,
  FetchStore,
} from './resource';
import type {
  DataRuntime,
  DataRuntimeOptions,
  FetchFunction,
  FetchOptions,
  StandardSchemaV1,
} from './types';

export type CoreDataRuntime = Omit<DataRuntime, '$read'>;

interface HydrationControls {
  resume(): void;
  cancel(): void;
}

const hydrationControls = new WeakMap<CoreDataRuntime, HydrationControls>();

export function resumeDataHydration(runtime: CoreDataRuntime): void {
  hydrationControls.get(runtime)?.resume();
}

export function cancelDataHydration(runtime: CoreDataRuntime): void {
  hydrationControls.get(runtime)?.cancel();
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
    serializeState() {
      return store.serialize();
    },
    restoreState(state) {
      store.installRestoreRecords(state);
    },
  };
  registerDataRuntimeProvider(runtime, store);
  hydrationControls.set(runtime, {
    resume: () => store.resumeHydration(),
    cancel: () => store.cancelHydration(),
  });
  return runtime;
}

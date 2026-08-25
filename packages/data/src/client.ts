import {
  ActionStore,
  createAction,
} from './action';
import { runModuleInstanceDisposers } from './transparent-module';
import {
  createFetchEnvironment,
  createFetchResource,
  FetchStore,
} from './resource';
import type {
  ActionFunction,
  ActionOptions,
  DataRuntime,
  DataRuntimeOptions,
  FetchFunction,
  StandardSchemaV1,
} from './types';

/** Create an isolated request/cache/action ownership boundary. */
export function createDataRuntime(
  options: DataRuntimeOptions = {},
): DataRuntime {
  const environment = createFetchEnvironment(options.fetch, options.baseURL);
  const store = new FetchStore(environment);
  const actions = new ActionStore();

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

  const action = (<TResult, TInput = void>(
    target: string | URL,
    actionOptions: ActionOptions<TResult, TInput> = {},
  ) => createAction(
    environment,
    actions,
    target,
    actionOptions,
  )) as ActionFunction;
  const runtime: DataRuntime = {
    $fetch: fetchResource,
    $action: action,
    clear() {
      actions.clear();
      store.clear();
      runModuleInstanceDisposers(runtime);
    },
    serializeState() {
      return store.serialize();
    },
    restoreState(state) {
      store.installRestoreRecords(state);
    },
  };
  return runtime;
}

import { createAction } from './action';
import {
  createFetchEnvironment,
  createFetchResource,
  FetchStore,
} from './resource';
import type {
  ActionFunction,
  ActionOptions,
  FetchFunction,
  FetchOptions,
  StandardSchemaV1,
} from './types';

interface DataRuntimeOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseURL?: string | URL;
}

interface DataRuntime {
  readonly $fetch: FetchFunction;
  readonly $action: ActionFunction;
  clear(): void;
}

/** Private environment boundary. It is not part of the package exports. */
export function createDataRuntime(
  options: DataRuntimeOptions = {},
): DataRuntime {
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

  const action = (<TResult, TInput = void>(
    target: string | URL,
    actionOptions: ActionOptions<TResult, TInput> = {},
  ) => createAction(
    environment,
    target,
    actionOptions,
  )) as ActionFunction;

  return {
    $fetch: fetchResource,
    $action: action,
    clear: () => store.clear(),
  };
}

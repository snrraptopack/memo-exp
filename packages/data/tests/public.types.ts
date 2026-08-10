import {
  createDataRuntime,
  type DataRuntime,
  type DataRuntimeOptions,
} from '../src';

const options = {
  baseURL: new URL('https://example.test/api/'),
  fetch: globalThis.fetch,
} satisfies DataRuntimeOptions;

const runtime: DataRuntime = createDataRuntime(options);

runtime.$fetch<unknown>('users');
runtime.$action<unknown>('users');
runtime.clear();

// @ts-expect-error Runtime capabilities are stable, read-only bindings.
runtime.$fetch = createDataRuntime().$fetch;

// @ts-expect-error Only URL-compatible base values are accepted.
createDataRuntime({ baseURL: 42 });

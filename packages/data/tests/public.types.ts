import {
  $fetch,
  $ops,
  $track,
  createDataRuntime,
  type DataRuntime,
  type DataRuntimeOptions,
  type ResolvedValue,
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

interface User {
  id: number;
  name: string;
}

const user = $fetch<User>('/user');
const assignableUser: User = user;
const preservedSource: ResolvedValue<User> = user;
void assignableUser.name;
void preservedSource.id;
void $track(user).pending;
void $track(user).error;
$ops(user).refresh();
$ops(user).update(current => ({ ...current!, name: 'Grace' }));

// @ts-expect-error Operations never collide with or decorate the payload.
user.refresh();

const todos = $fetch<Array<{ id: number }>>('/todos');
$ops(todos).append({ id: 1 });

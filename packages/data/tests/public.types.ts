import {
  $action,
  $fetch,
  $track,
  createDataRuntime,
  type DataRuntime,
  type DataRuntimeOptions,
  type ResolvedValue,
} from '../src';
import * as data from '../src';

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

const user = $fetch<User>('/user', { cache: { scope: 'app' } });
const assignableUser: User = user;
const preservedSource: ResolvedValue<User> = user;
void assignableUser.name;
void preservedSource.id;
void $track(user).pending;
void $track(user).error;

// @ts-expect-error The legacy operations facade is no longer public.
data.$ops(user);

// @ts-expect-error Operations never collide with or decorate the payload.
user.refresh();

const createUser = $action<User, { name: string }>('/users');
const creation = createUser({ name: 'Grace' });
void creation.id;
void creation.state;
void creation.data.name;
void creation.error.message;

// @ts-expect-error Action invocation results are not promises.
creation.then(() => {});

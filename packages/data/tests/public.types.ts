import {
  $action,
  $fetch,
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

const user = $fetch<User>('/user', { cache: { scope: 'app' } });
const savedUser = $fetch<User>('/user', {
  method: 'PATCH',
  body: { id: 1, name: 'Grace' },
});
const assignableUser: User = user;
const preservedSource: ResolvedValue<User> = user;
void assignableUser.name;
void preservedSource.id;
void $track(user).pending;
void $track(user).error;
void $track(user).id;
$track(user).onSuccess((data, requestId) => {
  void data.name;
  void requestId;
});
$track(user).onError((error, requestId) => {
  void error.message;
  void requestId;
});
void $track(user).refresh();
$track(user).abort();
void savedUser.name;
void $track(savedUser).pending;

// @ts-expect-error HTTP methods use the canonical uppercase spelling.
$fetch('/user', { method: 'post', body: { id: 1 } });

// @ts-expect-error Generated fetch bodies must be transport-safe.
$fetch('/user', { method: 'POST', body: { callback() {} } });

// @ts-expect-error BigInt requires an explicit application-level encoding.
$fetch('/user', { method: 'POST', body: { id: 1n } });

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

import {
  $fetch,
  $forms,
  $read,
  $track,
  createDataRuntime,
  type DataRuntime,
  type DataRuntimeOptions,
  type GroupProps,
  type ResolvedValue,
  type StandardSchemaV1,
} from '../src';

const options = {
  baseURL: new URL('https://example.test/api/'),
  fetch: globalThis.fetch,
} satisfies DataRuntimeOptions;

const runtime: DataRuntime = createDataRuntime(options);

const pendingGroup: GroupProps = { pending: () => null, children: ['static', null] };
const errorGroup: GroupProps = { error: ({ error, retry }) => {
  void error.message;
  retry();
  return null;
} };
const inheritedGroup: GroupProps = {};
void pendingGroup;
void errorGroup;
void inheritedGroup;

runtime.$fetch<unknown>('users');
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
const nullableUser = $fetch<User | null>('/optional-user');
void assignableUser.name;
void preservedSource.id;
// @ts-expect-error Nullable endpoint results must be narrowed before payload reads.
void nullableUser.name;
if (nullableUser !== null) void nullableUser.name;
void $track(nullableUser).pending;
$track(nullableUser).onSuccess(data => {
  if (data !== null) void data.name;
});
void $track(user).pending;
// @ts-expect-error Tracking does not expose the payload.
void $track(user).value;
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

const promisedUser = Promise.resolve<User>({ id: 1, name: 'Ada' });
const readUser = $read(promisedUser);
void readUser.name;
void $track(readUser).pending;
$track(readUser).onSuccess(value => void value.name);
// @ts-expect-error Bare promises are not trackable.
$track(promisedUser);

const form = $forms((fields: FormData) => String(fields.get('name')));
void form.pending;
void form.errors[0]?.kind;
void form.result;
const formTracker = $track(form);
formTracker.onSuccess(value => void value.toUpperCase());
// @ts-expect-error A form starts another execution through submit, not refresh.
formTracker.refresh();
// @ts-expect-error The form tracker has no payload slot.
void formTracker.value;

const nameSchema: StandardSchemaV1<unknown, { name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ value: { name: 'Ada' } }),
  },
};
$forms({ schema: nameSchema, action: fields => fields.name.toUpperCase() });

// @ts-expect-error HTTP methods use the canonical uppercase spelling.
$fetch('/user', { method: 'post', body: { id: 1 } });

// @ts-expect-error Generated fetch bodies must be transport-safe.
$fetch('/user', { method: 'POST', body: { callback() {} } });

// @ts-expect-error BigInt requires an explicit application-level encoding.
$fetch('/user', { method: 'POST', body: { id: 1n } });

// @ts-expect-error Operations never collide with or decorate the payload.
user.refresh();

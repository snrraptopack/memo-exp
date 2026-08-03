# Data loading API: `$fetch` and `$action`

> **Status:** Design proposal. Nothing in this document is implemented yet.
> The examples describe the intended user-facing contract so the API can be
> discussed before compiler or runtime code makes it difficult to change.

## 1. Goal

Memoized DOM needs one small, type-safe API for asynchronous data that fits its
existing model:

- components are ordinary synchronous functions;
- local variables and assignments are already reactive;
- component factories are created once rather than rerun after every change;
- dependencies and ownership should be discovered by the compiler;
- the runtime should update only DOM that can observe a changed result;
- the same authored component should eventually work in the browser and during
  server rendering.

The proposed public API has two operations:

```ts
import { $action, $fetch } from '@memoized-dom/data';
```

- **`$fetch` reads data.** It starts automatically and returns a stable resource
  whose state changes over time.
- **`$action` changes something.** It does nothing until the application calls
  it and returns a promise for that particular invocation.

The `$` prefix means that the compiler understands the operation. These are
still explicit imports: there are no hidden globals, and TypeScript can expose
their complete types.

This is intentionally not `useFetch`, `createResource`, a signal, or a hook.
The compiler supplies component identity, reactive dependencies, and cleanup
ownership.

## 2. The smallest useful API

A component that only needs to load data should look like this:

```tsx
interface User {
  id: string;
  name: string;
}

function Users() {
  const users = $fetch<User[]>('/api/users');

  return (
    <section>
      {users.pending && <p>Loading...</p>}
      {users.error && <p>{users.error.message}</p>}

      {users.data?.map(user => (
        <p key={user.id}>{user.name}</p>
      ))}
    </section>
  );
}
```

No cache option is required. No effect starts the request. No dependency array
describes when it should run. No callback copies the response into another
piece of state.

A component that sends data should look like this:

```tsx
interface Todo {
  id: string;
  title: string;
}

interface CreateTodo {
  title: string;
}

function Composer() {
  let title = '';

  const createTodo = $action<Todo, CreateTodo>('/api/todos', {
    method: 'POST',
  });

  async function create() {
    const todo = await createTodo({ title });
    title = '';
    console.log('Created', todo.id);
  }

  return <>
    <input
      value={title}
      onInput={event => title = event.currentTarget.value}
    />

    <button disabled={createTodo.pending} onClick={create}>
      {createTodo.pending ? 'Creating...' : 'Create'}
    </button>

    {createTodo.error && <p>{createTodo.error.message}</p>}
  </>;
}
```

The generic order is **result first, input second**:

```ts
$action<Result, Input>(target, options)
```

This keeps the first generic consistent with `$fetch<Result>()`. In most
applications both types will eventually be inferred from a typed endpoint or
schema, so users will not normally write these generics.

## 3. `$fetch`: reactive read resources

### 3.1 Basic signature

Conceptually:

```ts
function $fetch<T>(
  target: string | URL | null,
  options?: FetchOptions,
): FetchResource<T>;
```

`$fetch` is for read operations. In the URL-based API it performs a `GET`.
Mutation methods and request bodies belong to `$action`, which keeps the two
mental models separate.

### 3.2 Resource state

```ts
type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

interface FetchResource<T> {
  readonly data: T | undefined;
  readonly error: RequestError | null;
  readonly status: AsyncStatus;

  /** True while any request for this resource is active. */
  readonly pending: boolean;

  /** True when old data is visible while a newer response is loading. */
  readonly refreshing: boolean;

  refresh(): Promise<T>;
  abort(): void;

  /** Replace locally stored data and notify only its compiled consumers. */
  update(change: (current: T | undefined) => T): void;

  /** Mutate locally stored data in place and notify its compiled consumers. */
  mutate(change: (current: T | undefined) => void): void;
}
```

The properties have separate purposes:

| Property | Meaning |
|---|---|
| `status` | Whether the resource has no target, is cold-loading, has usable data, or failed without usable data |
| `data` | The latest successful value, if one exists |
| `error` | The latest non-cancellation failure, if one exists |
| `pending` | A request is currently in flight |
| `refreshing` | A request is in flight and previous `data` is still visible |

`pending` does not mean that the screen must be empty. During a refresh,
`status` remains `success`, while `pending` and `refreshing` are both true and
`data` still contains the previous result.

The intended transitions are:

| Situation | `status` | `pending` | `refreshing` | `data` | `error` |
|---|---|---:|---:|---|---|
| Paused target | `idle` | false | false | `undefined` | `null` |
| First request | `pending` | true | false | `undefined` | `null` |
| First request succeeds | `success` | false | false | new value | `null` |
| First request fails | `error` | false | false | `undefined` | failure |
| Refreshing existing data | `success` | true | true | old value | `null` |
| Refresh succeeds | `success` | false | false | new value | `null` |
| Refresh fails | `success` | false | false | old value | failure |

A refresh failure does not destroy usable data or turn the whole resource into
an unusable state. The component can continue rendering `data` and optionally
show `error` as a non-blocking warning. Calling `refresh()` again clears that
error when the next request starts.

The resource is deliberately not a proxy around `T`. A `FetchResource<User[]>`
cannot pretend to be a `User[]`; callers access `users.data`. This preserves
honest TypeScript types and avoids runtime read tracking.

The initial design should also avoid making the resource itself thenable. A
resource can restart many times, while a promise represents one fixed
operation. `await users.refresh()` is explicit about which operation is being
awaited. Future server rendering can wait for registered resources internally
without changing the component API.

### 3.3 Destructuring and reactivity

Destructuring should remain reactive inside a compiled component:

```tsx
function Users() {
  const resource = $fetch<User[]>('/api/users');
  const { data: users, pending, error } = resource;

  return <>
    {pending && <p>Loading...</p>}
    {error && <p>{error.message}</p>}
    {users?.map(user => <p key={user.id}>{user.name}</p>)}
  </>;
}
```

The compiler treats `users`, `pending`, and `error` as aliases of resource
fields and replays those aliases when the resource changes. This is consistent
with memoized-dom already replaying component-local `const` derivations.

Direct destructuring is also valid:

```ts
const { data: users, pending, error } =
  $fetch<User[]>('/api/users');
```

This loses access to `refresh()` and `update()` unless those methods are also
destructured. Keeping the resource object is therefore preferable when the
component performs commands against it.

Resource methods must be implemented as bound functions rather than depending
on JavaScript's dynamic `this`, so this remains safe:

```ts
const { refresh } = resource;
await refresh();
```

This live destructuring is a compiler guarantee inside analyzed components. In
ordinary uncompiled JavaScript, destructuring a changing object would produce a
one-time snapshot.

### 3.4 Reactive request arguments

Request arguments are ordinary expressions:

```tsx
function SearchUsers() {
  let search = '';
  let page = 1;

  const users = $fetch<User[]>('/api/users', {
    query: { search, page },
  });

  return <>
    <input onInput={event => search = event.currentTarget.value} />
    <button onClick={() => page++}>Next page</button>
    {users.data?.map(user => <p key={user.id}>{user.name}</p>)}
  </>;
}
```

The compiler records that this resource depends on `search` and `page`. When
either value changes it:

1. computes the new request description;
2. determines whether its identity actually changed;
3. stops observing the obsolete request;
4. starts or joins the new request;
5. marks only consumers of `users` when its state changes.

The user does not wrap the URL in a callback and does not maintain a dependency
array. This direct static relationship is one of the API's memoized-dom-native
features.

### 3.5 Pausing a request

`null` is the one explicit paused target:

```ts
const user = $fetch<User>(
  userId ? `/api/users/${userId}` : null,
);
```

While the target is `null`:

- no request is started;
- `status` is `idle`;
- `pending` is false;
- an obsolete in-flight request is unsubscribed or aborted;
- previous data is cleared unless a future option explicitly asks to retain it.

`false`, an empty string, and `undefined` should not be additional pause
sentinels. One sentinel keeps both runtime behavior and TypeScript narrowing
clear.

### 3.6 Query parameters

```ts
type QueryPrimitive = string | number | boolean | null;
type QueryValue =
  | QueryPrimitive
  | undefined
  | readonly QueryPrimitive[];

interface FetchOptions {
  query?: Readonly<Record<string, QueryValue>>;
  headers?: HeadersInit;
}
```

`undefined` omits a query field. Arrays produce repeated fields. Keys are
normalized in a stable order for request identity, but their order in the
authored object has no semantic meaning.

```ts
$fetch('/api/posts', {
  query: {
    page: 2,
    tag: ['typescript', 'compiler'],
    draft: false,
    search: undefined,
  },
});
```

This produces the logical equivalent of:

```text
/api/posts?draft=false&page=2&tag=typescript&tag=compiler
```

### 3.7 Manual refresh and abort

`refresh()` always starts a network request, even when stored data is still
fresh:

```tsx
<button disabled={users.pending} onClick={() => users.refresh()}>
  Refresh
</button>
```

It resolves with the new data or rejects with `RequestError`.

`abort()` stops this resource's interest in the current browser request. If
another live component shares the same request, the underlying request remains
active for that component. Cancellation is not exposed as an error state.

### 3.8 Local data updates

`mutate()` changes successful data in place without making a request:

```ts
todos.mutate(current => {
  current?.push(todo);
});
```

Its callback result is ignored, so the number returned by `Array.push()` can
never accidentally replace the resource's array.

`update()` requires its callback to return a replacement:

```ts
todos.update(current => [...(current ?? []), todo]);
```

The two methods must remain separate. TypeScript contextually permits an
expression-returning callback where a `void` callback is expected. Combining
mutation and replacement in one callback would therefore make this common code
unsafe at runtime:

```ts
// Array.push returns a number. A combined API could mistake it for new data.
items => items.push(todo)
```

`mutate()` supports the project's efficient direct-mutation model. `update()`
supports replacement when a new top-level value is needed.

After the callback, the runtime marks the compiled consumers of that resource.
DOM setters and keyed regions still suppress unchanged work.

An update performed **after** an action succeeds is not optimistic:

```ts
const todo = await createTodo(input);
todos.mutate(items => items?.push(todo));
```

The application waited for the server and then updated local data. True
optimistic behavior is covered in section 7.

## 4. Caching without a hidden mental model

Caching needs two separate concepts:

1. **Sharing:** can two live components use the same active request/result?
2. **Retention:** does the result survive after all components stop using it?

The default should handle sharing but not long-term retention. Most users never
need to configure a cache to get safe request deduplication.

### 4.1 Default: active sharing

This is the complete default behavior:

```ts
const users = $fetch<User[]>('/api/users');
```

- If two mounted components ask for the same request, they share one request.
- They share the resulting data while either component remains mounted.
- When the final consumer unmounts, the stored entry is removed.
- Mounting the component again later performs a new request.

There is no freshness timer and no background refresh under the default.

Conceptually, the default is:

```ts
cache: 'active'
```

The user does not need to write it.

For example, suppose three different components contain this declaration:

```ts
const users = $fetch<User[]>('/api/users');
```

The sharing sequence is:

1. Component A mounts and starts `/api/users`.
2. Component B mounts while that request is pending. B joins A's request; the
   browser does not send a second request.
3. The request succeeds. A and B observe the same stored `User[]` value.
4. Component C mounts while A or B is still alive. C receives the stored data
   immediately and does not send another request under the default policy.
5. A, B, and C all unmount. The entry is removed.
6. A component mounts later and starts a new request because no retained entry
   remains.

Therefore, **yes: the same normalized URL in different live places receives
the shared data**. It is not enough for only the URL text to match if query
parameters or identity-relevant headers differ. Those describe a different
request.

This is memoized-dom's in-memory resource sharing. It is separate from the
browser's HTTP cache, service-worker cache, and server caching headers.

### 4.2 Disabling sharing

```ts
const privateResult = $fetch<User[]>('/api/users', {
  cache: false,
});
```

This resource owns its request and result. An identical `$fetch` in another
component does not join it. This is useful when headers or environmental state
make a request private and no safe shared identity is available.

### 4.3 Opting into application retention

Persistent in-memory caching is explicit:

```ts
const users = $fetch<User[]>('/api/users', {
  cache: {
    scope: 'app',
    refreshAfter: 30_000,
    removeUnusedAfter: 5 * 60_000,
  },
});
```

The names describe two different moments:

- **`refreshAfter`** starts when a request succeeds. Before this duration passes,
  stored data is fresh and can be reused without a network request. After it
  passes, the data may still be displayed, but the next use also starts a
  background refresh.
- **`removeUnusedAfter`** starts when the last component stops using the entry. After
  this unused duration passes, the entry is deleted completely. The next use is
  a cold load with no stored data.

`refreshAfter` concerns when data should next be checked with the server.
`removeUnusedAfter` concerns memory usage when nobody is displaying that data.
They are not two names for the same timer.

An earlier sketch called these `freshFor` and `keepFor`. Those names were
placeholders and were too vague. This revision uses longer names that say what
happens when each duration ends. These controls are advanced and deferred;
neither appears in an ordinary `$fetch` call.

Example timeline:

| Time | Event | Result |
|---:|---|---|
| `0s` | Request succeeds | Data is stored and fresh |
| `10s` | Another component asks for it | Stored data is used; no request |
| `30s` | `refreshAfter` is reached | Data becomes eligible for refresh |
| `40s` | Another component asks for it | Old data displays immediately and refresh starts |
| `45s` | Refresh succeeds | New data replaces old data; freshness restarts |
| `60s` | Last consumer unmounts | Unused-retention timer starts |
| `360s` | `removeUnusedAfter` is reached | Entry is removed from memory |

No request starts merely because a freshness duration elapsed. A refresh starts
when the stale entry is used again, when `refresh()` is called, or eventually
when an explicit policy such as refocus/reconnect requests it. This avoids one
timer and network operation per dormant entry.

Proposed cache type:

```ts
type FetchCache =
  | false
  | 'active'
  | {
      scope: 'app';
      refreshAfter?: number;
      removeUnusedAfter?: number;
    };
```

If application retention is enabled without durations:

```ts
cache: { scope: 'app' }
```

the data remains fresh until `refresh()` is called and remains in memory for
the application's lifetime. This is suitable for nearly static configuration,
but applications should use it deliberately.

### 4.4 Request identity

Sharing requires a deterministic identity. For URL reads, the runtime derives
it from:

- normalized URL;
- normalized query parameters;
- relevant request headers;
- response-decoding mode.

Sensitive headers must not accidentally merge two users' requests. The exact
header policy must be conservative. When automatic identity is insufficient,
the caller supplies a typed serializable key:

```ts
type RequestKeyPart = string | number | boolean | null;

interface FetchOptions {
  key?: string | readonly RequestKeyPart[];
}
```

```ts
const profile = $fetch<Profile>('/api/profile', {
  key: ['profile', accountId],
  headers: { Authorization: token },
});
```

There is no implicit route namespace. If two routes describe the same request,
they should be able to share it. If they describe different entities, their URL,
query, typed endpoint input, or explicit key should say so.

## 5. Type safety

There are three levels of type safety, and the API should be honest about them.

### 5.1 URL plus generic: compile-time assertion

```ts
const users = $fetch<User[]>('/external/users');
```

TypeScript knows that `users.data` is `User[] | undefined`, but the generic
cannot prove what an external server returned. This is an assertion supplied by
the developer, like `response.json() as User[]`.

This remains the normal short form:

```ts
const users = $fetch<User[]>('/api/users');
```

The validation form below is an optional alternative, not an additional
requirement and not a replacement for this call.

### 5.2 URL plus Standard Schema: checked external data

The response type can be inferred and checked using any Standard Schema
implementation:

```ts
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const users = $fetch('/external/users', {
  validate: z.array(UserSchema),
});
```

`validate` answers one specific question: "Does the decoded response actually
have the shape the application expects?" Zod is only an example. Any library
implementing Standard Schema can be used, and applications that do not want
runtime validation do not pass this option.

The difference is:

| Call | TypeScript type | Runtime response check |
|---|---|---|
| `$fetch<User[]>(url)` | Supplied by the developer | No |
| `$fetch(url, { validate: UsersSchema })` | Inferred from the schema | Yes |

The schema overload is especially useful for third-party APIs whose response
cannot be guaranteed by the application. A future typed server endpoint will
provide stronger end-to-end types without requiring this option at every call.

Conceptually:

```ts
interface CheckedFetchOptions<TSchema extends StandardSchema> {
  validate: TSchema;
}

function $fetch<TSchema extends StandardSchema>(
  target: string | URL | null,
  options: CheckedFetchOptions<TSchema> & FetchOptions,
): FetchResource<InferOutput<TSchema>>;
```

A response that fails validation becomes a `RequestError` with a validation
cause. Invalid data never enters `resource.data`.

### 5.3 Typed application endpoint: inferred input and output

The future server layer should generate or expose typed endpoint references:

```ts
import { getUser } from './users.server';

const user = $fetch(getUser, {
  input: { id: userId },
});
```

`input.id`, the response type, HTTP details, and server validation are inferred
from `getUser`. No explicit generic is necessary. This should become the
preferred API for application-owned server code.

The initial browser-only implementation can support URL generics and Standard
Schema validation without prematurely inventing the server endpoint format.

## 6. `$action`: explicit writes

### 6.1 Basic signature

```ts
interface Action<TResult, TInput> {
  (
    input: TInput,
    options?: ActionCallOptions<TResult>,
  ): Promise<TResult>;

  readonly data: TResult | undefined;
  readonly error: RequestError | null;
  readonly status: AsyncStatus;
  readonly pending: boolean;

  abort(): void;
  reset(): void;
}

function $action<TResult, TInput = void>(
  target: string | URL,
  options?: ActionOptions<TResult, TInput>,
): Action<TResult, TInput>;
```

The returned action is callable rather than requiring `.run()`:

```ts
const rename = $action<User, { id: string; name: string }>(
  '/api/users/rename',
  { method: 'PATCH' },
);

const changedUser = await rename({ id, name });
```

Calling the action returns the promise for that invocation. The action's
properties are reactive UI state for the latest invocation.

### 6.2 Input encoding

The browser URL form uses these rules:

- a plain object or array is encoded as JSON and receives an
  `application/json` content type unless the caller supplied one;
- `FormData`, `Blob`, `ArrayBuffer`, `URLSearchParams`, and strings pass through
  using native fetch behavior;
- `undefined` sends no body;
- response decoding follows the response content type unless a schema or
  explicit mode overrides it.

These rules should be visible in the types. The implementation must not inspect
or proxy arbitrary class instances and guess how to serialize them.

### 6.3 Action options

```ts
type ActionMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ActionOptions<TResult, TInput> {
  method?: ActionMethod; // default: POST
  headers?: HeadersInit;
  query?: Readonly<Record<string, QueryValue>>;

  concurrency?: 'parallel' | 'latest' | 'queue' | 'drop';

  onSuccess?: (
    result: TResult,
    input: TInput,
  ) => void | Promise<void>;

  onError?: (
    error: RequestError,
    input: TInput,
  ) => void | Promise<void>;

}

interface ActionCallOptions<TResult> {
  optimistic?: OptimisticChange<TResult>;
  refresh?: readonly FetchResource<unknown>[];
}
```

The initial version only needs `method`, headers, query, `onSuccess`, and
`onError`. Concurrency modes and declarative refresh should be implemented only
after their behavior is tested against real applications.

### 6.4 Action concurrency

The proposed default is `parallel`:

- every call gets its own promise;
- `pending` remains true while at least one invocation is active;
- `data`, `error`, and `status` describe the most recently started invocation;
- an older invocation settling late cannot replace the visible state of a newer
  invocation;
- every returned promise still resolves or rejects independently.

Possible explicit modes:

| Mode | A call made while another is active |
|---|---|
| `parallel` | Starts immediately |
| `latest` | Stops client interest in the previous call and starts the new one |
| `queue` | Waits and starts in order |
| `drop` | Does not start another call |

Aborting a browser request cannot guarantee that a server mutation did not
happen. For this reason `latest` must never be described as transactional
server cancellation.

### 6.5 Updating or refreshing reads after success

The most explicit approach is ordinary code:

```ts
const created = await createTodo(input);

todos.mutate(current => {
  current?.push(created);
});
```

Or request authoritative data again:

```ts
await createTodo(input);
await todos.refresh();
```

An action callback can package the same behavior:

```ts
const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  method: 'POST',

  onSuccess(created) {
    todos.mutate(current => {
      current?.push(created);
    });
  },
});
```

For a common refresh-only relationship, invocation options can remain typed and
reference the resource directly:

```ts
await reorderTodos(input, {
  refresh: [todos],
});
```

This is preferable to string cache tags in the core API. Resource references
are checked by TypeScript, cannot collide by spelling, and make the data flow
visible at the operation that caused it. A create action that returns the
complete created item normally does not refresh its list; its optimistic change
can commit that returned item directly.

### 6.6 Reset and abort

`reset()` returns the visible action state to its initial form:

```ts
status === 'idle'
data === undefined
error === null
pending === false
```

It does not reverse a successful server operation.

`abort()` stops active client requests owned by the action. Cancellation rejects
the invocation promise with a recognizable abort error but should not populate
the action's visible `error` field. It also cannot promise that the server did
not already process the operation.

## 7. Optimistic updates

An optimistic update changes the UI **before** the server confirms success.

Updating after success is intentionally simple, but it is not optimistic:

```ts
const created = await createTodo(input);
todos.mutate(items => items?.push(created));
```

True optimistic behavior has three unavoidable jobs:

1. apply a temporary value immediately;
2. restore the previous value if the operation fails;
3. reconcile with authoritative server data if it succeeds.

The previous draft exposed all three jobs as callbacks, which was too verbose
for the common case. It should not be the front-facing API.

### 7.1 Proposed concise action transaction

Collection resources produce typed optimistic changes. The action consumes the
change as an invocation option:

```ts
const temporary: Todo = {
  id: `temporary:${crypto.randomUUID()}`,
  title: input.title,
};

const created = await createTodo(input, {
  optimistic: todos.append(temporary),
});
```

This has a complete contract without another network request:

- `append(temporary)` inserts the temporary item immediately;
- it returns a transaction object rather than exposing rollback callbacks;
- if creation fails, the transaction removes the temporary item;
- if creation succeeds, the transaction replaces that exact temporary item
  with `created`, the action's authoritative result;
- `createTodo` still resolves to `created` for ordinary application logic.

Other mutation shapes follow the same model:

```ts
// Create: append now, remove on failure, replace with action result on success.
await createTodo(input, {
  optimistic: todos.append(temporary),
});

// Update: replace now, restore old item on failure, use result on success.
await updateTodo(input, {
  optimistic: todos.replace(existingTodo, optimisticTodo),
});

// Delete: remove now and reinsert at its old position on failure.
await deleteTodo(existingTodo.id, {
  optimistic: todos.remove(existingTodo),
});
```

`append` and `replace` are type-compatible only with actions whose result is the
collection's item type. `remove` ignores a successful action result and commits
the removal. The transaction remembers the affected item and position, so it
does not deep-clone the entire collection.

`refresh` remains available for operations whose item result cannot describe
all server changes. Examples include server-side sorting, pagination, aggregate
statistics, permission filtering, or changes to a different resource:

```ts
await createTodo(input, {
  optimistic: todos.append(temporary),
  refresh: [todoStatistics],
});
```

Here the returned todo reconciles `todos`; only `todoStatistics` is fetched
again.

Overlapping optimistic operations still need an ordered transaction log. A
failed older append must remove only its own temporary item and must not erase a
newer successful append. The package implementation should model changes by
item/reference and position rather than restore an old whole-array snapshot.

There should be no large action-level `optimistic`, `commit`, and `rollback`
callback family in the core API.

## 8. Forms

The long-term form syntax can build on `$action` instead of introducing a third
async system:

```tsx
const createTodo = $action<Todo, FormData>('/api/todos', {
  method: 'POST',
});

return (
  <form action={createTodo}>
    <input name="title" />
    <button disabled={createTodo.pending}>Create</button>
    {createTodo.error && <p>{createTodo.error.message}</p>}
  </form>
);
```

In a browser-only application, the compiler recognizes the action value,
prevents normal navigation, creates `FormData`, and invokes the action. With a
future server layer, the same authored form can receive a real endpoint and
progressively enhance when JavaScript is available.

This should not be implemented in the first `$action` pass. Initially,
applications can use a normal submit handler:

```tsx
async function submit(event: SubmitEvent) {
  event.preventDefault();
  await createTodo(new FormData(event.currentTarget as HTMLFormElement));
}

return <form onSubmit={submit}>...</form>;
```

Validation should use typed server endpoints or Standard Schema rather than a
framework-specific schema interface. We should design object conversion and
progressive enhancement with the server layer, not guess now.

## 9. Errors

Both primitives use one error shape:

```ts
class RequestError<TData = unknown> extends Error {
  readonly status: number | null;
  readonly statusText: string | null;
  readonly data: TData | undefined;
  readonly cause: unknown;
  readonly kind: 'network' | 'http' | 'decode' | 'validation';
}
```

- Network failures use `kind: 'network'` and have no HTTP status.
- Non-successful responses use `kind: 'http'` and retain any decoded error body.
- Malformed JSON or another decoding failure uses `kind: 'decode'`.
- Standard Schema failure uses `kind: 'validation'`.
- Cancellation uses the platform's abort error and is not stored as a visible
  application failure.

Awaited action calls and `resource.refresh()` reject with the error. Automatic
`$fetch` execution stores it on `resource.error`; it must not create an
unhandled promise rejection merely because the component renders the error
state instead of awaiting anything.

## 10. Compiler and runtime ownership

Initially, both declarations should be direct component declarations:

```tsx
function Page() {
  const users = $fetch<User[]>('/api/users');
  const save = $action<User, UpdateUser>('/api/users', { method: 'PATCH' });

  return <main>...</main>;
}
```

The compiler should reject unclear placements, such as creating a new resource
inside an event handler or arbitrary loop. The diagnostic must be shared by the
compiler API, Vite, and the language service.

For each `$fetch`, the compiler provides:

- a stable component-instance and call-site identity;
- statically discovered request dependencies;
- the compiled consumers of resource fields;
- component, branch, or row cleanup ownership;
- a generated request-description function used only when dependencies change.

For each `$action`, it provides:

- stable component ownership;
- instrumentation for callback writes;
- cleanup of active client requests;
- exact consumers of action state.

The runtime owns only changing facts: active requests, decoded results,
generation tokens, shared-entry reference counts, and optional retained cache
entries. It should not discover JavaScript dependencies by observing property
reads.

## 11. Browser/server boundary

The API should depend on an internal request environment rather than directly
hard-code browser globals:

```ts
interface RequestEnvironment {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  resolve(input: string | URL): URL;
  getCache(): FetchStore;
}
```

The browser environment uses `globalThis.fetch`, the document URL, and an
application store.

A future server environment will:

- resolve relative URLs against the incoming request;
- forward permitted cookies and headers;
- use a per-request store by default, preventing cross-user leakage;
- collect fetch resources started by rendering;
- await them before final HTML emission;
- serialize successful records into the page;
- let the browser adopt matching records without another cold request.

This keeps the component identical on both sides. It does not require separate
`serverFetch`, `clientFetch`, or hydration-only calls in authored code.

Application-retained server caching, if added later, must be explicitly marked
and must never accidentally store user-specific responses globally.

## 12. Proposed first implementation

The first implementation should remain deliberately smaller than the complete
design.

### `$fetch` v1

- URL or `null` target;
- GET requests;
- typed generic result;
- optional Standard Schema response validation;
- query and headers;
- `data`, `error`, `status`, `pending`, and `refreshing`;
- `refresh()`, `abort()`, and `update()`;
- `mutate()` for explicit in-place data changes;
- default active sharing;
- generation tokens preventing stale responses from winning;
- compiler-discovered reactive request dependencies;
- owner cleanup and precise consumer invalidation.

### `$action` v1

- URL target;
- callable action returning an invocation promise;
- POST, PUT, PATCH, and DELETE;
- generic input/result types;
- JSON and native body encoding;
- `data`, `error`, `status`, and `pending`;
- `reset()` and `abort()`;
- latest-visible generation protection;
- `onSuccess` and `onError` callbacks;
- action call options consuming typed `append`, `replace`, and `remove`
  optimistic changes.

### Deferred until demonstrated by applications

- persistent application cache durations;
- concurrency modes beyond parallel;
- declarative `refresh: [resource]`;
- `<form action={action}>` transformation;
- typed server endpoint references;
- server rendering and hydration transport.

Deferring these features does not close architectural doors. It lets the core
resource and action semantics become reliable before conveniences depend on
them.

## 13. Open decisions for discussion

1. **Imports:** use explicit imports as proposed, or make `$fetch` and `$action`
   global compiler intrinsics like `effect` currently is?
2. **Default cache:** should active sharing disappear with the final consumer,
   or remain for a short fixed duration to make immediate remounts free?
3. **Action state:** should `data` and `error` represent the latest-started
   invocation, or the latest invocation that actually settled?
4. **Change names:** are `resource.mutate()` for in-place changes and
   `resource.update()` for replacement clear enough, or should replacement use
   `set()` instead?
5. **Response checking:** should URL calls encourage a required Standard Schema
   in development, or allow generic assertions as the normal escape hatch?
6. **Optimistic helper:** is explicit application code sufficient, or should
   the concise `resource.optimistic(replacement, operation)` transaction become
   part of the first public design?
7. **Forms:** should `<form action={action}>` be the only special integration,
   or should actions also expose an explicit `onSubmit` helper?

These decisions affect the front-facing mental model. They should be settled
with real examples before implementation begins.

## 14. Non-goals

This design does not introduce:

- a general signal or observable system;
- runtime dependency tracking;
- proxy-wrapped server data;
- component-function reruns;
- automatic deep equality over every response;
- implicit route-based cache scopes;
- automatic global query invalidation after every mutation;
- one overloaded primitive for queries, mutations, forms, and RPC;
- hidden full-data cloning for optimistic rollback.

The API should feel small because compile-time ownership does the difficult
work, not because important lifecycle behavior is left undefined.

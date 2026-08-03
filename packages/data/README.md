# `@memoized-dom/data`

Browser-first fetch resources and callable actions for memoized-dom.

> **Current scope:** this package implements data behavior only. It is not yet
> connected to the memoized-dom compiler or DOM runtime. Resource getters
> change correctly, but a component will not automatically render again until
> compiler integration is implemented separately.

## Public API

The package currently exposes three runtime values:

```ts
import {
  $action,
  $fetch,
  RequestError,
} from '@memoized-dom/data';
```

- `$fetch` automatically performs a read request and returns a stable resource.
- `$action` creates a lazy callable operation for writes.
- `RequestError` describes network, HTTP, decoding, and validation failures.

There is intentionally no public client factory, cache client, provider, hook,
or global configuration API.

## `$fetch`

### Basic request

```ts
interface User {
  id: string;
  name: string;
}

const users = $fetch<User[]>('/api/users');
```

The request starts automatically. `$fetch<User[]>()` tells TypeScript that a
successful decoded response is expected to be `User[]`.

The generic is a developer assertion. It does not validate the server response
at runtime. Optional runtime validation is explained later.

### Resource state

```ts
users.data;       // User[] | undefined
users.error;      // RequestError | null
users.status;     // 'idle' | 'pending' | 'success' | 'error'
users.pending;    // boolean
users.refreshing; // boolean
```

The initial cold request has this state:

```ts
users.status === 'pending';
users.pending === true;
users.refreshing === false;
users.data === undefined;
users.error === null;
```

After success:

```ts
users.status === 'success';
users.pending === false;
users.data !== undefined;
```

After an initial failure:

```ts
users.status === 'error';
users.pending === false;
users.data === undefined;
users.error instanceof RequestError;
```

During a refresh, previous data remains available:

```ts
users.status === 'success';
users.pending === true;
users.refreshing === true;
users.data; // previous successful data
```

A failed refresh preserves previous data. `status` remains `success`, and
`error` contains the refresh failure so the application may display a
non-blocking warning.

### Query parameters

```ts
const users = $fetch<User[]>('/api/users', {
  query: {
    search: 'Ada',
    page: 2,
    active: true,
    tag: ['compiler', 'typescript'],
  },
});
```

Query values may be strings, numbers, booleans, `null`, arrays of those values,
or `undefined`. An `undefined` value is omitted. Arrays produce repeated query
fields. Query keys are normalized so equivalent requests share the same
identity regardless of object property order.

### Request headers

```ts
const profile = $fetch<Profile>('/api/profile', {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

Headers participate in automatic request identity. Requests with different
authorization values therefore do not share data by default.

### Paused resource

`null` is the only paused target:

```ts
const user = $fetch<User>(
  userId ? `/api/users/${userId}` : null,
);
```

A paused resource has `status: 'idle'` and performs no request. Automatic
reevaluation when `userId` changes belongs to the future compiler integration;
the standalone package receives only the value passed at creation.

### Manual refresh

```ts
const latestUsers = await users.refresh();
```

`refresh()` always performs a new request and resolves with its decoded result.
Existing data remains visible while it runs.

### Abort

```ts
users.abort();
```

Aborting detaches this resource from its active shared request. If it was the
last consumer, the underlying request is aborted. If another resource still
uses that request, the request continues for the other resource.

Cancellation is not stored as `resource.error`.

### Replacing data

`update()` requires the callback to return the new top-level value:

```ts
users.update(current => [
  ...(current ?? []),
  newUser,
]);
```

### Direct mutation

`mutate()` ignores the callback's result and preserves the existing top-level
value:

```ts
users.mutate(current => {
  current?.push(newUser);
});
```

These are deliberately separate. `Array.push()` returns a number, so an API
that treats callback returns as optional replacements could accidentally store
that number instead of the array.

Use `mutate()` for direct in-place changes and `update()` when a replacement is
required.

## Resource sharing

The default sharing mode is active sharing:

```ts
const first = $fetch<User[]>('/api/users');
const second = $fetch<User[]>('/api/users');
```

When both declarations describe the same normalized request:

1. The first resource starts the request.
2. The second resource joins that request instead of sending another one.
3. Both resources observe the same decoded value.
4. A third resource created while either remains active receives that value
   immediately without another request.
5. After the final resource is disposed by the future integration layer, the
   entry is removed.
6. A later resource performs a new request.

The identity includes the normalized URL, query, headers, and validator. An
explicit key can replace automatic identity when necessary:

```ts
const profile = $fetch<Profile>('/api/profile', {
  key: ['profile', accountId],
});
```

### Sharing options

The current package implements only three clear modes:

```ts
// Default: share while at least one resource is active.
$fetch<User[]>('/api/users');

// Private: never share this resource's request or result.
$fetch<User[]>('/api/users', {
  cache: false,
});

// Retain for this package instance until its internal store is cleared.
$fetch<User[]>('/api/users', {
  cache: { scope: 'app' },
});
```

No freshness or retention duration is implemented in version `0.0.1`. Timing
options remain a design discussion and are not part of the package API.

This sharing store is separate from the browser HTTP cache, service workers,
and server `Cache-Control` headers.

## Optional response validation

This short form trusts the developer's generic assertion:

```ts
const users = $fetch<User[]>('/api/users');
```

For an external or untrusted API, a Standard Schema validator can infer and
check the decoded response:

```ts
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const users = $fetch('/external/users', {
  validate: z.array(UserSchema),
});
```

Here `users.data` is inferred as `User[] | undefined`. If the response does not
match the schema, invalid data is not stored and `users.error.kind` is
`'validation'`.

`validate` is optional. It does not replace the generic form and is not required
for application-owned endpoints.

## Destructuring

In the standalone package, normal JavaScript destructuring is a snapshot:

```ts
const { data, pending } = users;
```

Those two variables do not change by themselves because this package does not
rewrite JavaScript. The planned compiler integration will recognize resource
destructuring and replay the aliases when resource state changes:

```tsx
const { data: users, pending, error } =
  $fetch<User[]>('/api/users');
```

That live behavior is documented as part of the intended framework API, but it
is not claimed by the standalone package today.

Methods are bound functions and are safe to extract:

```ts
const { refresh } = users;
await refresh();
```

## `$action`

### Creating and invoking an action

```ts
interface Todo {
  id: string;
  title: string;
}

interface CreateTodo {
  title: string;
}

const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  method: 'POST',
});

const created = await createTodo({
  title: 'Write documentation',
});
```

Creating the action sends no request. Calling it performs one invocation and
returns that invocation's promise.

Plain object and array inputs are encoded as JSON. Strings, `FormData`, blobs,
URL search parameters, array buffers, and other supported native request bodies
are passed through without JSON conversion.

The default method is `POST`. Supported methods are `POST`, `PUT`, `PATCH`, and
`DELETE`.

### Action state

```ts
createTodo.data;    // Todo | undefined
createTodo.error;   // RequestError | null
createTodo.status;  // 'idle' | 'pending' | 'success' | 'error'
createTodo.pending; // boolean
```

Every invocation receives its own promise. The initial implementation permits
parallel calls. Visible `data`, `error`, and `status` belong to the most recently
started invocation; an older request settling late cannot overwrite newer
visible state.

```ts
createTodo.abort();
createTodo.reset();
```

`abort()` stops active client requests. It cannot guarantee that a server did
not already process a mutation. `reset()` aborts active work and returns visible
state to `idle`.

### Success and error callbacks

```ts
const createTodo = $action<Todo, CreateTodo>('/api/todos', {
  onSuccess(created, input) {
    console.log('Created', created.id, 'from', input.title);
  },

  onError(error, input) {
    console.error('Could not create', input.title, error);
  },
});
```

Normal `try`/`catch` around the returned invocation promise remains valid and
does not require callbacks.

## Optimistic collection changes

An array resource exposes three typed change constructors:

```ts
todos.append(temporary);
todos.replace(current, temporary);
todos.remove(current);
```

They apply immediately and return an opaque optimistic change consumed by an
action invocation.

### Create

```ts
const created = await createTodo(input, {
  optimistic: todos.append(temporary),
});
```

- `temporary` appears immediately.
- Failure removes only that temporary item.
- Success replaces that exact item with `created`, the action result.
- The list is not fetched again.

### Update

```ts
const saved = await updateTodo(input, {
  optimistic: todos.replace(existing, optimisticVersion),
});
```

- `existing` is replaced immediately.
- Failure restores `existing`.
- Success installs `saved` in place of `optimisticVersion`.

`existing` should be the actual object reference obtained from `todos.data`.

### Delete

```ts
await deleteTodo(existing.id, {
  optimistic: todos.remove<void>(existing),
});
```

- `existing` is removed immediately.
- Failure reinserts it at its previous position.
- Success keeps it removed.

Rollback operations target their own temporary/current item instead of
restoring a complete old array. A failed older action therefore does not erase
unrelated later additions.

## Optional related-resource refresh

Creating an item normally returns that item, so the optimistic list should
commit from the result rather than refetch itself:

```ts
await createTodo(input, {
  optimistic: todos.append(temporary),
});
```

Refresh is only for another resource whose authoritative value cannot be
derived from the returned item:

```ts
await createTodo(input, {
  optimistic: todos.append(temporary),
  refresh: [todoStatistics],
});
```

The action result reconciles `todos`. Only `todoStatistics` is requested again.
Refresh requests start after the action succeeds and do not delay the action's
returned result.

## Errors

```ts
class RequestError<TData = unknown> extends Error {
  readonly kind: 'network' | 'http' | 'decode' | 'validation';
  readonly status: number | null;
  readonly statusText: string | null;
  readonly data: TData | undefined;
  readonly issues: readonly StandardSchemaIssue[] | undefined;
}
```

Automatic `$fetch` requests store failures in `resource.error` without causing
an unhandled rejection. Awaited `refresh()` and action calls reject normally.

## Future integration

No compiler or DOM-runtime adapter is publicly exported in this pass. A future
integration will need to:

- schedule DOM consumers when resource/action state changes;
- preserve reactive resource destructuring;
- update requests when compiled arguments change;
- dispose component, branch, and row-owned resources.

None of those compiler changes are part of this package pass.

The complete evolving design and deferred server behavior live in the root
`data-loading-api.md` document.

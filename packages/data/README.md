# `@memoized-dom/data`

`@memoized-dom/data` is Memoized DOM's data-fetching and state synchronization package. It provides **Colorless Async** transparent values, request deduplication, optimistic mutations, schema validation, declarative pending/error JSX directives, and zero-roundtrip SSR payload transport.

There are no hooks, provider trees, signals, or store wrappers. Fetched data behaves as plain TypeScript values and arrays in your components.

---

## 1. The Colorless Async Paradigm

`$fetch<T>` returns a compiler-aware `ResolvedValue<T>`. In your templates and derived state, you consume it as the plain type `T`:

```tsx
import { $fetch } from '@memoized-dom/data';

export interface User {
  id: number;
  name: string;
  avatar: string;
}

// 1. Module-scope source: lazy declaration, request-isolated during SSR
export const currentUser = $fetch<User>('/api/session');

// 2. Direct transparent reads in any component:
export function UserProfile() {
  return (
    <div class="user-card">
      <span class="avatar">{currentUser.avatar}</span>
      <h2>{currentUser.name}</h2>
    </div>
  );
}
```

- **Zero Boilerplate**: No `useQuery`, no `.data` access required, and no `async/await` component wrappers.
- **Push Invalidation**: The compiler links data reads to their render regions. When a fetch resolves, updates push directly to the target DOM nodes without frame polling.

---

## 2. Declarative State Arms (`Group`, `Pending`, `Error`)

Handle loading skeletons and error states declaratively without ternary clutter:

```tsx
import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { stories, type Story } from './session';

function LoadingSkeleton() {
  return <ul class="skeleton-list"><li>Loading stories…</li></ul>;
}

function ErrorBanner({ error, retry }: { error: { message: string }; retry: () => void }) {
  return (
    <div class="error-box">
      <p>{error.message}</p>
      <button onClick={retry}>Try Again</button>
    </div>
  );
}

export function StoriesPanel() {
  return (
    <section class="panel">
      <h2>Top Stories</h2>

      <Group data={stories}>
        <Pending component={LoadingSkeleton} />
        <ErrorArm component={ErrorBanner} />
        {/* Resolved arm: renders automatically once data settles */}
        <ul class="story-list">
          {stories.map(item => (
            <li key={item.id}>
              <span>{item.title}</span>
              <span class="votes">{item.votes}</span>
            </li>
          ))}
        </ul>
      </Group>
    </section>
  );
}
```

- **`Pending`**: Shown independently at source-consuming sites while their
  initial requests are in flight.
- **`Error`**: Injects `{ error, retry }` into the error component when a request fails.
- **Content**: Mounts immediately by default; each dependent expression or
  structural site resolves independently.

To make the first mount atomic, the third child may be one direct component
marked with the shorthand compiler directive `suspend`:

```tsx
<Group data={{ profile, activity }}>
  <Pending component={DashboardSkeleton} />
  <ErrorArm component={ErrorBanner} />
  <Dashboard suspend profile={profile} activity={activity} />
</Group>
```

The pending arm appears once until every named source has its initial value.
The compiler removes `suspend` before component prop checking and emission.
Committed content remains visible during later refreshes.

---

## 3. Imperative Operations (`$ops`)

Use `$ops(value)` to trigger mutations, refreshes, or manual aborts without polluting your payload types:

```tsx
import { $ops } from '@memoized-dom/data';
import { stories } from './session';

// 1. In-place optimistic mutation (propagates to all readers immediately):
function upvote(id: number) {
  $ops(stories).mutate(items => {
    for (const item of items ?? []) {
      if (item.id === id) item.votes++;
    }
  });
}

// 2. Functional replacement:
function removeStory(id: number) {
  $ops(stories).update(items => (items ?? []).filter(item => item.id !== id));
}

// 3. Manual revalidation / refresh:
async function refreshFeed() {
  await $ops(stories).refresh();
}

// 4. Aborting in-flight requests:
function cancel() {
  $ops(stories).abort();
}
```

---

## 4. Fine-Grained Reactive Tracking (`$track`)

When you need to inspect request status (e.g. showing a spinning sync icon during background refresh):

```tsx
import { $track, $ops } from '@memoized-dom/data';
import { notifications } from './session';

export function SyncButton() {
  // `$track` reactively observes background refresh & pending state:
  const state = $track(notifications);

  return (
    <button
      class={state.refreshing ? 'spinning' : ''}
      onClick={() => void $ops(notifications).refresh()}
    >
      {state.refreshing ? 'Syncing…' : 'Refresh'}
    </button>
  );
}
```

### Tracked State Properties:
- `state.status`: `'idle' | 'pending' | 'success' | 'error'`
- `state.pending`: `true` during cold initial load
- `state.refreshing`: `true` during background revalidation (previous data remains visible)
- `state.error`: `RequestError | null`

---

## 5. Callable Actions (`$action`) & Optimistic Changes

`$action` creates lazy, callable endpoints for server mutations (POST / PUT / PATCH / DELETE):

```ts
import { $action } from '@memoized-dom/data';

interface Todo { id: number; title: string; done: boolean; }
interface NewTodoInput { title: string; }

export const createTodo = $action<Todo, NewTodoInput>('/api/todos', {
  method: 'POST',
  onSuccess(created, input) {
    console.log('Created todo:', created.id);
  },
  onError(error, input) {
    console.error('Failed to create:', error.message);
  },
});
```

### Calling with Optimistic List Changes:
```ts
// Applies immediately, rolls back if the network fails, or commits from server result
const result = await createTodo({ title: 'New task' }, {
  optimistic: todos.append({ id: -1, title: 'New task', done: false }),
});
```

---

## 6. Runtime Response Validation (Standard Schema v1)

Validate server responses at runtime using Zod, Valibot, or ArkType via the Standard Schema specification:

```ts
import { z } from 'zod';
import { $fetch } from '@memoized-dom/data';

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

export const user = $fetch('/api/user', {
  validate: UserSchema, // TypeScript infers User type automatically
});
```

If the response fails validation, `user` enters error state with `error.kind === 'validation'` and `error.issues` containing the schema breakdown.

---

## 7. Universal SSR & Zero-Roundtrip Payload Transport

During SSR, `@memoized-dom/data` coordinates request settling and serializes the state envelope into the streamed HTML:

```text
Server Stream:
  HTML Markup:   <!--mmd:r:App--><div class="user">Ada</div><!--/mmd-->
  State Envelope: <script type="application/mmd+json" data-mmd-root="App">
                    {"version":1,"state":{"sources":[{"sourceId":"GET|/api/session","snapshot":{...}}]}}
                  </script>
```

### Client Hydration:
1. `hydrate()` extracts the state envelope from the embedded script tag before rendering.
2. It restores the dormant records into the client's `DataRuntime`.
3. Client components adopt the server DOM with **zero duplicate network fetches and zero loading flash**.

```ts
// main.ts (Client Bootstrap)
import { mount } from '@memoized-dom/runtime';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { App } from './App';

setActiveDataRuntime(createDataRuntime());
mount('root', App, { hydration: { recover: true } });
```

---

## 8. Isolated Request Runtimes

For server request isolation or testing:

```ts
import { createDataRuntime, runWithDataRuntime } from '@memoized-dom/data';

const requestRuntime = createDataRuntime({
  fetch: customFetch,
  baseURL: 'https://api.internal.service',
});

// Run request within isolated cache boundary:
const result = await runWithDataRuntime(requestRuntime, async () => {
  await requestRuntime.settle();
  return requestRuntime.serializeState();
});
```

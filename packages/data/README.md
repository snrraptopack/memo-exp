# `@memoized-dom/data`

`@memoized-dom/data` is Memoized DOM's data-fetching and state synchronization package. It provides **Colorless Async** transparent values, safe GET deduplication, schema validation, declarative pending/error JSX directives, request lifecycle tracking, and zero-roundtrip SSR payload transport.

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

      <Group>
        <Pending component={() => <LoadingSkeleton />} />
        <ErrorArm component={({ error, retry }) => (
          <ErrorBanner error={error} retry={retry} />
        )} />
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
- **Dependencies**: The compiler infers exactly which colorless sources are
  read by the content. `Group` does not need a `data` prop.
- **Policies**: `component` accepts either a named component or a synchronous
  inline render callback. Inline callbacks may capture component-local values.

To make the first mount atomic, mark the one direct content element with the
shorthand compiler directive `suspend`. The element may be a component or a
host element:

```tsx
<Group>
  <Pending component={DashboardSkeleton} />
  <ErrorArm component={ErrorBanner} />
  <section suspend>
    <Dashboard profile={profile} activity={activity} />
  </section>
</Group>
```

The pending arm appears once until every inferred source has its initial value.
The compiler removes `suspend` before component prop checking and emission.
Committed content remains visible during later refreshes.

---

## 3. Direct Data Changes

Transparent values remain ordinary application data. Change the property that
actually changed; the compiler is responsible for routing that write to the
affected DOM work:

```tsx
import { stories } from './session';

function upvote(id: number) {
  const story = stories.find(item => item.id === id);
  if (story !== undefined) story.votes++;
}
```

---

## 4. Fine-Grained Reactive Tracking (`$track`)

When you need to inspect request status (e.g. showing a spinning sync icon during background refresh):

```tsx
import { $track } from '@memoized-dom/data';
import { notifications } from './session';

export function SyncButton() {
  // `$track` reactively observes background refresh & pending state:
  const state = $track(notifications);

  return (
    <button class={state.refreshing ? 'spinning' : ''}>
      {state.refreshing ? 'Syncing…' : 'Refresh'}
    </button>
  );
}
```

### Tracked State Properties:
- `state.id`: identity of this exact request execution
- `state.value`: the resolved value, or `undefined` before fulfillment
- `state.status`: `'idle' | 'pending' | 'success' | 'error'`
- `state.pending`: `true` during cold initial load
- `state.refreshing`: `true` during background revalidation (previous data remains visible)
- `state.error`: `RequestError | null`
- `state.onSuccess((data, requestId) => ...)`: one-shot success observation
- `state.onError((error, requestId) => ...)`: one-shot failure observation
- `state.refresh()`: starts another execution; awaiting is optional
- `state.abort()`: explicitly cancels the represented request

`$track` also accepts an ordinary promise. It exposes the same state and
one-shot outcome callbacks, and fills `state.value` when that promise fulfills.
Because a promise represents one fixed execution, `refresh()` awaits that same
promise and `abort()` is a no-op for this input.

---

## 5. Mutations and overlapping requests

Server-function facades and direct `$fetch` calls use the same transparent
result and `$track` lifecycle. Change application data directly, and record
the smallest inverse operation when optimistic rollback is required:

```ts
const pendingVotes = new Set<string>();

function vote(story: Story) {
  const result = postVote(story.id);
  const request = $track(result);

  pendingVotes.add(request.id);
  story.votes++;

  request.onSuccess((_data, requestId) => {
    pendingVotes.delete(requestId);
  });
  request.onError((_error, requestId) => {
    if (pendingVotes.delete(requestId)) story.votes--;
  });
}
```

Reassigning a local variable to a newer result changes what the UI displays;
it does not cancel older dispatched work. Each retained request delivers its
own callback before cleanup. Only `abort()` or an explicit `AbortSignal`
requests cancellation.

Non-GET requests are not deduplicated by default: two identical POSTs may be
two intentional operations. Disable or debounce a control to suppress rapid
client submissions. Use a domain idempotency key on the server when the
operation must be processed at most once.

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

### Client adoption:
1. `mount()` detects the server root and extracts its state envelope before rendering.
2. It restores the dormant records into the client's `DataRuntime`.
3. Client components adopt the server DOM with **zero duplicate network fetches and zero loading flash**.

```ts
// main.ts (Client Bootstrap)
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
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

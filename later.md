# Architecture Vision: Colorless Data, Request Tracking, and Optimistic State

## 1. Core Architectural Principle: Value vs. Tracker Separation

In Memoized DOM, we maintain a strict separation between **the data payload** and **the request lifecycle**:

| Entity | Role | Type | Primary Usage |
| :--- | :--- | :--- | :--- |
| **Transparent Value** (`result`, `stories`) | **The Data Payload** | `ResolvedValue<T>` (assignable to `T`) | Template rendering, expressions, reads (`stories.map(...)`, `story.votes`) |
| **Tracked Request** (`$track(result)`) | **The Request Lifecycle** | `TrackedValue<T>` | Event handlers, loading indicators, outcome callbacks (`onSuccess`, `onError`) |

### Key Tenets:
1. **The Value Stays 100% Colorless**:
   `const stories = getStories()` or `const result = vote(id)` returns transparent data.
   In application code, it behaves as a plain TypeScript value. It has no `.then()` method, no Promise wrapper, and requires no `.data` unwrapping.

2. **`$track(...)` is a Request Lens, Not a Store**:
   `$track(value)` observes and controls the request associated with a value. It
   does **not** have `.mutate()` or `.update()`, and never owns or alters the
   payload data structure.

3. **No Promise Pollution (`then` / `catch` removed)**:
   `$track` is **not** a Promise and does not implement `PromiseLike`. We do not force developers into `async / await` or `.then()` chains. Outcome handling is expressed through explicit `onSuccess` and `onError` lifecycle hooks.

---

## 2. The `$track` Interface

```ts
export interface TrackedValue<T> {
  /**
   * Unique execution ID for the current/latest in-flight request cycle.
   * Changes whenever a new request is triggered (e.g. initial fetch, refresh(), or action call).
   */
  readonly id: string;

  /** Status indicators */
  readonly status: 'idle' | 'pending' | 'success' | 'error';
  readonly pending: boolean;     // Cold initial load in-flight
  readonly refreshing: boolean;  // Background revalidation in-flight
  readonly error: RequestError | null;

  /** One-shot outcome callbacks for this exact execution */
  onSuccess(callback: (data: T, requestId: string) => void): () => void;
  onError(
    callback: (error: RequestError, requestId: string) => void,
  ): () => void;

  /** Imperative controls */
  refresh(): Promise<T>; // awaiting is optional
  abort(): void;
}
```

### Usage:
```ts
// Observe query state:
const stories = getStories();
const trackedStories = $track(stories);

// Or observe an action trigger:
const voteResult = vote(id);
const trackedVote = $track(voteResult);
```

---

## 3. Direct Client Mutation ("Like Our Count App")

In Memoized DOM, state updates operate directly on plain JavaScript objects in memory:

```tsx
// Ordinary local state:
let count = 0;
<button onClick={() => { count++; }}>{count}</button>
```

Fetched data follows the exact same philosophy. When data arrives on the client, it lives as transparent data in client memory. Developers mutate properties directly:

```ts
function upvote(id: number) {
  const story = stories.find(s => s.id === id);
  if (story) {
    story.votes++; // Direct mutation on transparent data; compiler updates DOM directly
  }
}
```

There is no need for `setStories(...)`, immutable array copies, or pseudo-store dispatchers like `$track.mutate()`.

---

## 4. Single-Action Optimistic Updates & Rollbacks

For an isolated action, developers mutate client data directly and register an
`onError` inverse operation. The request ID makes the rollback idempotent:

```ts
const pendingVotes = new Set<string>();

function handleVote(id: number) {
  const story = stories.find(s => s.id === id);
  if (!story) return;

  // 1. Call the endpoint and capture this exact execution.
  const tracked = $track(vote(id));
  const pending = tracked.id;

  // 2. Direct client mutation (DOM updates immediately).
  pendingVotes.add(pending);
  story.votes++;

  // 3. A failure reverses only this operation, not an old whole-object snapshot.
  tracked.onError((_error, requestId) => {
    if (pendingVotes.delete(requestId)) story.votes--;
  });

  // 4. Success confirms the already-visible increment.
  tracked.onSuccess((_data, requestId) => {
    pendingVotes.delete(requestId);
  });
}
```

---

## 5. Concurrent Optimistic Mutations

### The Problem: Rapid Clicks & Distributed Concurrency
In real applications, users may click rapidly, firing multiple concurrent requests (e.g., Request 1 through Request 7):
- **Out-of-order resolution**: Request 3 might fail due to network congestion or rate limits, while Request 7 succeeds.
- **Authoritative server state**: Request 7 might return `{ votes: 42 }` (which accounts for other concurrent users).
- **The flaw of manual rollback**: If Request 3 fails, simply restoring its previous local snapshot would wipe out the optimistic changes from Requests 4, 5, 6, and 7!

There is no universal optimistic manager. The runtime cannot know whether a
write is an increment, replacement, reorder, deletion, or a server-side change
to several records. Hidden cloning would also be expensive and would break
object identity.

Each operation records the smallest reversible change required by its domain.
A counter records a delta; a form may record changed fields; a reorder may
record previous indices. The request ID makes each journal entry independent:

```ts
const pending = new Map<string, { story: Story; delta: number }>();

function handleVote(id: number) {
  const story = stories.find(s => s.id === id);
  if (!story) return;

  const request = $track(vote(id));
  pending.set(request.id, { story, delta: 1 });
  story.votes++;

  request.onSuccess((_result, requestId) => {
    pending.delete(requestId);
  });

  request.onError((_error, requestId) => {
    const operation = pending.get(requestId);
    if (operation === undefined) return;
    operation.story.votes -= operation.delta;
    pending.delete(requestId);
  });
}
```

The framework deliberately does not provide a `createOptimistic` snapshot
manager. Whole-object snapshots cannot safely represent overlapping deltas,
reorders, deletes, and server-side changes. If absolute server convergence is
required, refresh the relevant query after the operation journal drains.

---

## 6. The Role of the Request `id`

Every request cycle generates an incrementing, unique client-runtime `id`
(e.g. `"request-1"`, `"request-2"`):
- When a query is re-fetched via `tracked.refresh()`, `tracked.id` updates to identify the new execution.
- When an action is invoked, its `$track(actionResult).id` represents that specific network attempt.

### Why `id` is Essential:
1. **Race Condition Prevention**:
   If a user triggers multiple actions in rapid succession, responses may arrive out of order. Comparing `tracked.id` ensures that stale responses cannot overwrite fresher state.
2. **Snapshot Map Keys**:
   Serves as the unambiguous map key for `snapshotMap = new Map<string, Snapshot>()` to correlate in-flight mutations with their exact pre-mutation state.
3. **Telemetry & Devtools**:
   Provides a client-side correlation key. It is not an HTTP idempotency key
   and is not sent to the server unless a future transport contract explicitly
   adds that behavior.

### Replacement and cancellation

Assigning a newer result to a local binding changes which operation the UI is
displaying; it does not cancel older dispatched work. The compiler detaches
the old operation from that render site, retains it until its exact
`onSuccess`/`onError` outcome is delivered, and then releases it. Only an
explicit `abort()` or supplied `AbortSignal` means cancellation.

Non-GET requests are not deduplicated by default. Two identical POST calls may
represent two intentional operations. Applications prevent accidental rapid
submission by disabling/debouncing controls, and servers that require
at-most-once processing use a domain idempotency key.

---

## 7. Architectural Boundaries (What to Avoid)

To keep the codebase modular, clean, and optimized:
- ❌ **Do NOT add `.mutate()` or `.update()` to `$track`**: `$track` is an observation lens, not a state manager.
- ❌ **Do NOT add `.then()` / `.catch()` to `$track`**: `$track` should not be a Promise or thenable. Use `onSuccess` and `onError`.
- ❌ **Do NOT expose compiler `EventSourceSlot` machinery as public API**:
  event-assigned variables remain ordinary authored locals. Private compiler
  slots may subscribe to the currently displayed request, but replacement
  must never imply cancellation.
- ❌ **Do NOT force developers into `effect()` hooks for event logic**: Event handling logic belongs in event handlers, not in reactive synchronization effects.

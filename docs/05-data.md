# Data loading

## Plain fetch works

You don't need anything special to load data. Call `fetch`, assign the
result to a variable, and the UI updates like any other state change:

```tsx
export function Profile() {
  let name = '';
  let loading = true;

  fetch('/api/profile')
    .then(res => res.json())
    .then(data => {
      name = data.name;
      loading = false;
    });

  return <p>{loading ? 'Loading…' : name}</p>;
}
```

For a lot of cases this is all you need. But notice what you had to do by
hand: a `loading` flag, `.then` chaining, and remembering to write every
field yourself when the data lands.

## The idea: async values that read like sync values

Memoized DOM tries to keep authored code **synchronous in shape**. An async
operation shouldn't force your markup into `loading`/`error` branches and
promise plumbing — you should be able to read the result like an ordinary
value and let the runtime handle when it's actually there.

That's what the two `$`-prefixed primitives in `@memoized-dom/data` are for:

- **`$fetch`** — the *value*. Declares a request and gives you the payload
  as if it were already resolved.
- **`$track`** — the *request*. A lens over that value's lifecycle:
  pending/success/error, retry, abort, outcome callbacks.

Strict separation: the value is always plain data; `$track` only observes
and controls the request behind it.

## `$fetch` — the payload as a plain value

```tsx
import { $fetch } from '@memoized-dom/data';

interface Story {
  id: number;
  title: string;
  votes: number;
}

export function Stories() {
  const stories = $fetch<Story[]>('/api/stories');
  const top = stories.filter(s => s.votes > 3);   // derivation — replays on arrival/refresh

  return (
    <ul>
      {top.map(s => (
        <li key={s.id}>{s.title} — {s.votes}</li>
      ))}
    </ul>
  );
}
```

Inside a component, each instance owns its source. Put `$fetch` at **module
scope** instead and it becomes one shared source for the whole app — every
component that reads it sees the same data:

```ts
// stories.ts
export const stories = $fetch<Story[]>('/api/stories');
```

- `stories` **is** `Story[]` — read properties, derive from it, `.map` it.
  No `.data`, no `.then`, no await.
- Render reads **wait for the value** — the list doesn't render against an
  empty `null`; it mounts when the payload commits, and re-renders when it
  changes.
- It's reactive like everything else: `stories.filter(...)` is a derived
  value that replays when the source resolves or refreshes.
- Mutating it works like normal state — `stories[0].votes++` updates the DOM
  (this is how optimistic updates are done, below).

One constraint: **don't destructure it at declaration** — `const { length }
= $fetch(...)` is a compile error (`[MMD-S004]`), because destructuring
evaluates immediately, before the source settles. Bind it plainly
(`const stories = ...`) and read properties at use sites.

## The binding is a derivation — change an input, the request reruns

Remember how `const doubled = count * 2` replays when `count` changes? A
`$fetch` binding works exactly the same way — it's a **derived value over
its request inputs**. Any reactive value inside the target or options is a
dependency of the derivation; when it changes, the request runs again and
the *same binding* receives the new payload:

```tsx
export function StoryPage() {
  let storyId = 1;

  // `storyId` is an input to this derivation —
  // change it and the request refires; `story` gets the new value
  const story = $fetch<Story>(`/api/stories/${storyId}`);

  return (
    <article>
      <h1>{story.title}</h1>
      <button onClick={() => storyId++}>Next story</button>
    </article>
  );
}
```

`storyId++` → new request → `story` re-renders with the new payload. You
never re-call `$fetch` yourself; the derivation does it, and everything that
reads `story` (markup, other derivations, a `Group`, a `$track`) keeps
observing the same stable binding.

The same is true for **function calls**: an imported function that returns
one of these transparent values re-runs when its arguments change —
`const story = getStory(id)` refires whenever `id` does. Inputs in,
derivation out — same rule everywhere.

## Request options and the query shape

```ts
const stories = $fetch<Story[]>('/api/stories', {
  query: {
    search: 'dom',                  // → ?search=dom
    page,                           // reactive — reruns when `page` changes
    tag: ['compiler', 'typescript'],// arrays → repeated params: &tag=compiler&tag=typescript
    filter: undefined,              // undefined values are omitted entirely
  },
  headers: { Authorization: `Bearer ${token}` },
});
```

The `query` object compiles into the request URL's search params — keys and
values are URL-encoded, arrays become repeated keys, `undefined` entries are
dropped. The normalized URL + query + headers form the request's identity
(two calls with the same shape share one request/cache entry); pass `key`
to override that identity yourself.

## `$track` — watching the request, not the data

`$track(value)` observes the request behind a value. It never touches the
payload — it's a lens with status fields and controls:

```tsx
import { $track } from '@memoized-dom/data';

const stories = $fetch<Story[]>('/api/stories');
const request = $track(stories);

export function Stories() {
  return (
    <section>
      {request.pending ? <p>Loading…</p> : null}
      {request.refreshing ? <p>Syncing…</p> : null}
      {request.error !== null ? (
        <p>
          {request.error.message}
          <button onClick={() => request.refresh()}>Retry</button>
        </p>
      ) : null}
      <ul>{stories.map(s => <li key={s.id}>{s.title}</li>)}</ul>
    </section>
  );
}
```

What `request` gives you:

| Member | Meaning |
|---|---|
| `id` | unique id of the current request execution — changes on each new request |
| `status` | `'idle' \| 'pending' \| 'success' \| 'error'` |
| `pending` | initial load in flight |
| `refreshing` | a re-request in flight while old data stays visible |
| `error` | `RequestError \| null` |
| `onSuccess(cb)` | fires once for this execution — `(data, requestId)` |
| `onError(cb)` | fires once on failure — `(error, requestId)` |
| `refresh()` | start a new request for the source (awaitable) |
| `abort()` | cancel the current execution |

Two rules: `$track` is **not a store** (no `.mutate`/`.update` — mutate the
value itself) and **not a promise** (no `.then` — use `onSuccess`/`onError`).

`$track` also accepts a **bare promise** — you don't need `$fetch` to get a
tracked request:

```tsx
const save = $track(saveDraft(draft));

save.onSuccess(() => toast('saved'));
save.onError((e) => toast(e.message));
```

A promise is exactly one execution, so the tracker is a subset of the
fetch-backed one: `pending`, `error`, `onSuccess`, and `onError` all work —
including retroactively if the promise already settled — while `refresh()`
just awaits the same work (there is nothing to re-request), `refreshing`
stays `false`, and `abort()` is a no-op since a promise has no cancellation
protocol. Tracking the same promise twice returns the same tracker.

## Optimistic updates — the real pattern

This is where the value/tracker split pays off. Mutate the value directly
for instant UI; use the tracker's callbacks to confirm or roll back:

```tsx
const stories = $fetch<Story[]>('/api/stories');
const pending = new Map<string, Story>();

function vote(id: number) {
  const story = stories.find(s => s.id === id);
  if (!story) return;

  const request = $track(postVote(id));
  pending.set(request.id, story);
  story.votes++;                          // instant UI

  request.onSuccess((_result, requestId) => {
    pending.delete(requestId);
  });

  request.onError((_error, requestId) => {
    const op = pending.get(requestId);
    if (op === undefined) return;
    op.votes--;                           // rollback only this attempt
    pending.delete(requestId);
  });
}
```

Why the `Map` keyed by `request.id`: rapid clicks fire overlapping requests.
Each `id` keys the smallest reversible change (here a `votes--` delta), so a
failed attempt rolls back *its own* mutation without wiping successful
optimistic writes from other in-flight attempts. Snapshotting the whole
object can't do that.

Next: [06 — Group](./06-group.md)

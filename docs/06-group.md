# Group — letting the markup own loading states

In the last doc you saw the manual version of loading UI:

```tsx
{request.pending ? <p>Loading…</p> : null}
{request.error !== null ? <p>{request.error.message}</p> : null}
{stories.map(s => <li key={s.id}>{s.title}</li>)}
```

That works, but it's machinery you're writing by hand — a `pending` branch,
an `error` branch, a retry button, around every place that reads fetched
data. `Group` removes it: you write the markup as if the data were already
there (the synchronous-authoring model again), and `Group` supplies the
pending and error UI for whatever isn't ready yet.

```tsx
import { $fetch, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
// `Error` is exported under that name — alias it so it doesn't shadow the global

const stories = $fetch<Story[]>('/api/stories');

function Skeleton() {
  return <p>Loading…</p>;
}

function Failure({ error, retry }) {
  return (
    <p>
      {error.message}
      <button onClick={retry}>Retry</button>
    </p>
  );
}

export function Stories() {
  return (
    <Group>
      <Pending component={Skeleton} />
      <ErrorArm component={Failure} />
      <ul>
        {stories.map(s => <li key={s.id}>{s.title}</li>)}
      </ul>
    </Group>
  );
}
```

The contract:

- **First child** — `<Pending component={...} />`: what to show while a
  source is loading.
- **Second child** — `<ErrorArm component={...} />`: what to show on failure.
  The component receives `{ error, retry }` — retrying is a boundary
  feature, not something bolted onto your data.
- **Last child** — your real content, written as plain synchronous markup.

## Independent sites — pending and error live *where the data is read*

`Group` doesn't block the whole subtree on the slowest request. The pending
policy **expands to each read site**: wherever markup touches unavailable
data, the placeholder appears at that spot — and only that spot. Everything
else renders as soon as it can.

```tsx
const stories = $fetch<Story[]>('/api/stories');
const me = $fetch<User>('/api/me');

export function Page() {
  return (
    <Group>
      <Pending component={Skeleton} />
      <ErrorArm component={Failure} />
      <section>
        <h1>{me.name}</h1>                       {/* Skeleton here */}
        <p>Signed in as {me.name}</p>            {/* and here — each read site gets its own */}
        <ul>
          {stories.map(s => <li key={s.id}>{s.title}</li>)}
        </ul>                                     {/* renders the moment stories lands */}
      </section>
    </Group>
  );
}
```

If `stories` resolves while `me` is still in flight, the list appears
immediately and **both** `{me.name}` spots show the skeleton independently.
Read `me` in four places → four skeletons. It's never one blocked tree.

Same rule on failure: if the `me` request errors, **each** of its read sites
renders the error component — the story list keeps working. One failed
request doesn't take down the section.

## `suspend` — wait for everything, mount once

Sometimes you *don't* want piecemeal rendering — a dashboard that looks
broken half-loaded, a component that needs all its props at once. Put the
bare `suspend` directive on the direct content element inside `Group`:

```tsx
export function Page() {
  return (
    <Group>
      <Pending component={DashboardSkeleton} />
      <ErrorArm component={DashboardFailure} />
      <Dashboard suspend user={me} stories={stories} />
    </Group>
  );
}
```

Now one pending policy covers the whole thing until **every** source the
compiler infers from that element has committed — then `Dashboard` mounts
atomically with all values ready.

It's not component-only — a host element takes it too:

```tsx
export function Page() {
  return (
    <Group>
      <Pending component={Skeleton} />
      <ErrorArm component={Failure} />
      <section suspend>
        <h1>{me.name}</h1>
        <ul>
          {stories.map(s => <li key={s.id}>{s.title}</li>)}
        </ul>
      </section>
    </Group>
  );
}
```

Same markup as before, but now nothing shows until both `me` and `stories`
have resolved — then the whole `<section>` mounts at once.

Details that matter:

- Write it bare — `suspend`, not `suspend={true}` (the valued form is
  rejected). It must sit on the direct child inside `Group`.
- It's a compile-time directive — it's consumed, never passed to
  `Dashboard` as a prop.
- `suspend` only controls the **first** mount. Later refreshes keep the
  committed UI on screen — it's not a "re-suspend on every fetch" switch.

## When to use which

| Shape | Reach for |
|---|---|
| Each read site shows its own placeholder as data lands | plain `Group` children |
| Content must appear all-at-once | `Group` + `suspend` |
| You need request status in *logic* (disable a button, journal a rollback) | `$track` — from the previous doc |

Next: [07 — Routing](./07-routing.md)

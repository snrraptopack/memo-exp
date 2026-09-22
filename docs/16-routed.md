# `$routed` — code that runs when a route matches

So far, the only way client code reached server code was `#server-functions`.
`$routed` is the other door — and it can do more: a `$routed` callback can
read `services` directly, so server-only work (a database query, the
request's cookies) can back a component without a functions file at all.

```tsx
import { $routed } from '@memoized-dom/router';

export function Story() {
  const story = $routed(({ params }) => ({ slug: params.id }));

  return <h1>{story.slug}</h1>;
}
```

`$routed(prepare)` registers a **route preparation**: a function that runs
whenever a matching route is navigated to, before the component renders.
What it returns is what the binding holds — `story` above *is* the object,
not a promise and not a wrapper.

## It must belong to a route

A preparation only runs when its route matches — so a component (or the
file) containing `$routed` must be attached to a `route`:

```tsx
export function Page() {
  return (
    <main>
      <Story route="/story/:id" />   {/* Story's $routed runs on /story/* */}
    </main>
  );
}
```

If the component never sits under a `route`, nothing can ever trigger its
preparation — that's a compile error, not silent dead code
("`$routed` in component 'X' is never prepared…").

## The context — universal fields

The callback receives one context object. These fields work identically
on client and server:

| Field | |
|---|---|
| `url` | the navigation target as `URL` — `url.pathname`, `url.search` |
| `params` | the route's params — `/story/:id` → `{ id }` |
| `query` | read-only query (`query.get('page')`) |
| `signal` | `AbortSignal` — aborted if the user navigates away mid-preparation |
| `state` | a mutable bag that **persists across navigations** to this route |

```tsx
const data = $routed(({ params, signal, state }) => {
  state.visits = (state.visits as number ?? 0) + 1;   // survives revisits
  return { id: params.id, visits: state.visits };
});
```

`state` is per-preparation cache space — stash things between visits
(it's serialized into the SSR payload, so server-prepared state arrives
intact on the client).

## The server-only fields — where the door is

Four more fields classify the whole callback as **server-backed**:

| Field | |
|---|---|
| `request` | the incoming `Request` — headers, cookies |
| `locals` | per-request data from `createLocals` |
| `services` | shared dependencies from `createServices` — **the db lives here** |
| `platform` | host bindings |

```tsx
export function Story() {
  const story = $routed(async ({ params, services, locals }) => {
    return services.database.stories.findFor(params.id, locals.user);
  });

  return <h1>{story.title}</h1>;
}
```

Yes — write it like that. Use `services`, `locals`, `request`,
`platform` freely inside `$routed`, even though this component runs in the
browser. **The compiler decides at compile time where the callback runs**:
if it touches server-only fields, the body never ships to the client —
the browser gets a stub, the server executes the real code, and only the
return value crosses the wire. Nothing server-side can leak, and you
don't have to think about it — write the code, the compiler enforces the
boundary.

The one visible consequence: `console.log(services)` in such a callback
prints in your **server terminal**, not the browser console — the code
isn't in the browser.

## Tracking a preparation

A `$routed` result is the same kind of source `$fetch` returns, so it can
be `$track`ed — pending while a navigation prepares it, error if the
callback throws or the server call fails, `refresh()` to re-run it:

```tsx
import { $track } from '@memoized-dom/data';

export function Story() {
  const story = $routed(({ params }) => ({ slug: params.id }));
  const request = $track(story);

  return (
    <div>
      {request.pending ? <p>Preparing…</p> : null}
      {request.error !== null ? <p>{request.error?.message}</p> : null}
      <h1>{story.slug}</h1>
    </div>
  );
}
```

Same tracker shape as everywhere else — `id`, `status`, `onSuccess`,
`onError`, `abort`. Server-backed or not makes no difference to the
tracker; it just sees the source.

## Redirecting instead of rendering

Return `redirectRoute(...)` and the navigation reroutes — the component
never mounts:

```tsx
const data = $routed(({ locals }) => {
  if (locals.user === undefined) return redirectRoute('/login');
  return { user: locals.user };
});
```

## Rules

- **Attach it to a route** — orphan `$routed` is a compile error.
- **Return serializable data** — the result crosses HTTP/SSR boundaries.
  Return `url.pathname`, not the `URL` object; entities, not db handles.
- **Use server fields freely** — the compiler decides per callback where
  it runs; server-only fields mean the callback executes on the server
  and only its return value reaches the client.
- **It's extracted, not a runtime call** — `$routed` is compiler-lowered;
  calling it outside the compiled graph throws.

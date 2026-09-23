# Routing

Two compiler-owned JSX attributes cover app navigation: `route` declares what
renders where, `route-to` declares where a click goes. Both are erased at
compile time — they never reach the DOM or component props. No router
imports needed for the basics.

## `route` — conditional rendering by URL

Put `route` on an element or component; it mounts only when the URL matches:

```tsx
export function Main() {
  return (
    <main>
      <Home route="/" />
      <About route="/about" />
      <section route="/docs"><h1>Docs</h1></section>
    </main>
  );
}
```

- Works on intrinsic elements (`<section route="…">`) and components
  (`<Home route="…">`) — same behavior, the region owns the slot.
- The pattern must be a **static string** starting with `/`. No query, no
  hash, no dynamic expressions.
- Routes are **siblings** — each owns its own region and swaps independently
  as the URL changes. A `route` element inside a non-matching parent never
  renders (except the nesting case below).

### Patterns

```tsx
<Story route="/story/:id" />     {/* /story/42 → params.id = "42" */}
<Doc route="/docs/*" />          {/* catch-all — terminal only */}
```

- `:name` captures one segment into `params`.
- `*` captures the rest — must be the **last** segment.
- Two sibling routes can't share a pattern — `route="/"` twice is a compile
  error, and so are two patterns that normalize to the same shape
  (`/a/:x` vs `/a/:y`).

### Nesting — shared UI under a parent route

A `route` inside another `route` **joins** their patterns — and this is how
you build layouts. Everything the parent renders *outside* its child routes
is shared UI: it mounts once and stays put while the nested routes swap
beneath it.

```tsx
export function Main() {
  return (
    <main>
      <section route="/settings">
        {/* shared chrome — rendered for EVERY /settings/* URL */}
        <h1>Settings</h1>
        <nav>
          <a route-to="/settings/profile">Profile</a>
          <a route-to="/settings/security">Security</a>
        </nav>

        {/* the slot that swaps — each joins onto /settings */}
        <Profile route="/profile" />     {/* /settings/profile */}
        <Security route="/security" />   {/* /settings/security */}
        <section route="/">
          <p>Pick a section above.</p>   {/* /settings exactly */}
        </section>
      </section>
    </main>
  );
}
```

At `/settings/profile`: the heading and nav stay mounted (they're outside
the child routes), `<Profile>` renders in the slot. Clicking the Security
link swaps only `<Profile>` → `<Security>` — the chrome never re-renders, so
things like scroll position and local state inside it survive navigation.
At `/settings` exactly, the `route="/"` child shows — a child pattern of `/`
means "the parent's own path".

In a client build, an imported component used only at `route` callsites (such
as `Profile` above) loads as a separate chunk. The first matching chunk is
loaded before `mount()` hydrates or renders; later navigation loads it before
the route commits. A component declared locally or also used outside a route
stays in the eager bundle. Server rendering keeps the ordinary static import.

Rules for nesting:

- Child pattern + parent pattern = the full path. `route-to` targets the
  **joined** path (`/settings/profile`).
- The parent matches as a **prefix** — `/settings/profile` keeps the whole
  `<section>` mounted, including all its shared UI.
- A child can't reuse a param name the parent already declared
  (`/settings/:tab` containing `/:tab` → shadowing error).
- A catch-all parent (`/*`) can't have child routes.
- Deeper nesting composes the same way — a `/settings` child can itself
  contain routes that join further (`/settings/profile/:section`).

## `route-to` — declaring where a click goes

```tsx
<a route-to="/about">About</a>
<a route-to="/settings/profile">Profile</a>
```

Two rules up front:

- The target **must be a declared `route`** — `route-to` to a path no
  `route` declares is a compile error. The compiler knows your route table
  and refuses dead links.
- It goes on **intrinsic elements only** — `<a>`, `<div>`, `<button>`, etc.
  `<Nav route-to>` on a component is rejected; put it on the actual
  clickable element the component renders.

### What it compiles to

- **On `<a>`**: becomes a real `href` (`<a href="/about">`) plus a global
  click interceptor — client-side navigation when JS runs, plain browser
  navigation when it doesn't. Don't also write `href`; that's an error.
- **On anything else**: gets an `onClick` that calls `navigateRoute`. If the
  element already has `onClick`, your handler runs first and navigation is
  skipped when the event is `defaultPrevented`.

### The object form — params, query, hash, replace

A route with params needs the object form (a bare string is an error telling
you so):

```tsx
<a route-to={{
  path: '/story/:id',
  params: { id: story.id },
  query: { tab: 'comments' },
  hash: 'top',
}}>
  {story.title}
</a>
```

- `path` is the **full declared pattern** — for a nested route that's the
  joined path (`/settings/profile`), not the child segment.
- `params` must match the route's declared params **exactly** — missing or
  extra keys are compile errors. Values can be dynamic (`story.id`).
- `query` and `hash` build into the URL.
- `replace: true` navigates with history `replace` instead of `push`.
- Object keys must be static — no spreads.

### Programmatic escape hatch

When a click isn't the trigger, `navigate` from `@memoized-dom/router` takes
the same pattern + params shape:

```ts
import { navigate } from '@memoized-dom/router';

navigate('/story/:id', { params: { id: story.id } });
```

## Cheat sheet

| Write | Get |
|---|---|
| `<X route="/path" />` | renders only at `/path` |
| `route` inside `route` | joined pattern, parent as layout |
| `<a route-to="/path">` | real `href` + client interception |
| `<div route-to={…}>` | click → `navigateRoute` |
| `route-to` with params | object form, exact param keys |
| `route-to` to undeclared path | compile error — dead links impossible |

Next: [08 — Router API](./08-router-api.md)

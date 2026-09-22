# Effects & cleanup

`effect` and `cleanup` are **compiler intrinsics — you never import them**.
Write them as bare calls; the compiler discovers them and lowers them into
runtime registrations. (The `@memoized-dom/compiler/jsx` types in your
tsconfig are what make them valid in the editor.)

Before reaching for `effect`, check you're not solving a solved problem:

- Loading data → a `fetch` call in an event handler, or a server function
- Recomputing a value → a `const` derivation
- One-time setup tied to the component's life → `cleanup` (below)

`effect` is for what's left: **imperative work that must re-run whenever the
reactive state it reads changes** — pushing state into systems the compiler
can't see (the document, sockets, media APIs, third-party widgets).

**Don't `fetch` inside an effect.** If you want to load data, just do it —
right in the component or module body. Writes inside the `.then` callbacks
update the UI normally:

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

If you'd rather use `await`, put the fetch inside an `async` function and
call it — same thing:

```tsx
export function Profile() {
  let name = '';
  let loading = true;

  async function load() {
    const res = await fetch('/api/profile');
    name = (await res.json()).name;
    loading = false;
  }

  load();

  return <p>{loading ? 'Loading…' : name}</p>;
}
```

## `effect` — re-syncing on state change

No dependency array. The compiler reads the callback body and re-runs it
whenever any reactive value inside changes.

```tsx
export function Chat({ roomId }: { roomId: string }) {
  let unread = 0;

  // reruns every time `unread` changes — pushes state outward
  effect(() => {
    document.title = unread === 0 ? 'Chat' : `Chat (${unread})`;
  });

  // re-subscribes every time `roomId` changes
  effect(() => {
    const connection = joinRoom(roomId);
    connection.onMessage(() => unread++);
    return () => connection.leave();     // optional cleanup
  });

  return <button onClick={() => unread = 0}>Mark read ({unread})</button>;
}
```

Behavior, concretely:

- **Runs after the DOM settles** — first run and every rerun happen in a
  post-render phase, after DOM writes and derived values drain. An effect
  always sees a consistent tree.
- **Re-runs on dependency change, not mount/unmount.** Whatever the callback
  reads is what schedules it. `document.title` above re-syncs per `unread`
  write; the connection re-opens per `roomId` change.
- **Return value = optional teardown.** If the callback returns a function,
  it runs *before each rerun* and *when the owner is destroyed* (row
  removed, branch swapped, unmounted). Returning anything else throws.
  Returning nothing is fine — `document.title` needs no teardown.
- **Must be synchronous.** No `async`, no generators — the teardown contract
  needs a sync boundary.
- **Placement**: a top-level statement in the component body — not buried in
  nested functions or arbitrary control flow.
- **Never runs during SSR** — the server registers it but skips the body;
  it first runs on the client after hydration.

If a value only gates *whether* work happens, read it inside the callback:

```tsx
effect(() => {
  if (!enabled) return;          // flips work on/off without teardown
  const conn = connect();
  return () => conn.close();
});
```

## Passing a named function — "effect refs"

The callback doesn't have to be inline — pass a function declared in the
**same module** (`function` declaration or `const` arrow):

```tsx
export function Presence({ roomId }: { roomId: string }) {
  function connect() {
    const socket = join(roomId);
    return () => socket.leave();
  }

  effect(connect);   // reads inside `connect` are tracked the same way

  return <p>{roomId}</p>;
}
```

Two limits:

- The named callback **cannot be imported** — `effect(fnFromAnotherFile)` is
  a compile error. Wrap locally instead: `effect(() => fn())`.
- Still synchronous, still not a JSX component.

## Conditional effects

Wrap `effect` in a top-level `if` and its whole lifecycle is owned by the
condition — not just early-return, actual create/dispose:

```tsx
export function AutoSaver({ docId }: { docId: string }) {
  let dirty = false;

  function flushLoop() {
    const socket = sync(docId);
    return () => socket.close();
  }

  if (dirty) {
    effect(flushLoop);   // exists only while `dirty` is true
  }
}
```

`dirty` → `false` runs the teardown and destroys the effect; `true` builds a
fresh one. The `if` branches may contain **only** `effect` calls, nested
`if`s, or empty statements — anything else is a compile error.

## Effects at module scope — effects can live in other files

`effect` also works at the top level of any linked module — a singleton
reactive entity that needs no component:

```ts
// theme.ts
export let theme: 'light' | 'dark' = 'light';

effect(() => {
  document.documentElement.dataset.theme = theme;
});
```

Side-effect wiring can live in dedicated files (`sync.ts`,
`subscriptions.ts`). Module effects read/write module state like anything
else; their teardown is owned by module re-evaluation (HMR), not unmount.

## `cleanup` — one-time teardown

A resource created **once** during component initialization needs disposing
**once** — that's `cleanup`, not `effect`. There's nothing reactive to
re-run; the timer below should keep ticking regardless of state:

```tsx
export function Clock() {
  let now = Date.now();

  const timer = setInterval(() => now = Date.now(), 1000);
  cleanup(() => clearInterval(timer));

  const onResize = () => now = Date.now();
  window.addEventListener('resize', onResize);
  cleanup(() => window.removeEventListener('resize', onResize));

  return <p>{new Date(now).toLocaleTimeString()}</p>;
}
```

- Ambient like `effect` — no import.
- Exactly one function argument, called directly in the component body.
- Multiple `cleanup` calls are fine — they run **last-in, first-out** on
  unmount.
- **Not valid at module scope** — at module level, use an `effect` and
  return its teardown.

## Which one?

| Situation | Use |
|---|---|
| Imperative work that must re-sync when state it reads changes | `effect` |
| That work holds a resource per run | `effect` returning a teardown |
| One-time resource for the component's lifetime | `cleanup` |
| Side work at app/module level | module-scope `effect` |
| Effect owned on/off by state | `if (cond) { effect(...) }` |
| Loading data / re-computing a value | `fetch` in a handler / server function / `const` derivation — **not** `effect` |

Next: [04 — Refs](./04-refs.md)

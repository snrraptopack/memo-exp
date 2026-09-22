# Server functions

## The `server` field

The vite plugin takes one more option besides `clientEntry`/`serverEntry`:

```ts
// vite.config.ts
memoizedDom({
  clientEntry: 'src/main.ts',
  serverEntry: 'server.ts',
  server: 'server',        // server-only root — the default
});
```

`server` names a folder that is **server-only territory** — nothing under
it is compiled into or reachable from the client bundle. Rename it
(`server: 'backend'`) and the conventions follow it. Inside that root,
the `functions/` subfolder is where server functions live:

```
server/
  functions/
    stories.ts
    users.ts
```

One tsconfig addition so TypeScript can resolve the special imports this
feature uses:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "#server/*": ["./server/*"],
      "#server-functions": ["./.memoized/server-functions.d.ts"]
    }
  },
  "include": ["src", ".memoized/**/*.d.ts"]
}
```

`#server-functions` is how client code reaches those functions. The
function bodies stay on the server — they never ship to the browser. What
the client imports is a generated facade: same names, same parameters,
same return types, but calling it fires an HTTP request instead of
running the real code.

It's also not a real file on disk — it's a virtual module the plugin
resolves at build time. The `paths` entry above points TypeScript at the
generated `.memoized/server-functions.d.ts` declarations (written on
dev/build), so the calls are fully typed end to end: rename a function or
change a parameter and the client call sites fail typecheck, not runtime.

## What a server function is

A file in `functions/` whose **verb-prefixed async exports** become HTTP
endpoints — the filename is the route namespace, the export name finishes
the path (`/_fn/<file>/<name>`):

```ts
// server/functions/stories.ts
export async function getStories() {       // GET  /_fn/stories/getStories
  return db.stories.findMany();
}

export async function postVote(id: number) { // POST /_fn/stories/postVote
  return db.stories.vote(id);
}
```

And client code just calls them — imported from `#server-functions`,
one flat barrel of every function across all files:

```tsx
// src/App.tsx — client code
import { getStories, postVote } from '#server-functions';

export function App() {
  const stories = getStories();          // a data source, like $fetch

  return (
    <ul>
      {stories.map(s => (
        <li key={s.id}>
          {s.title}
          <button onClick={() => postVote(s.id)}>Vote</button>
        </li>
      ))}
    </ul>
  );
}
```

## The rules

- **The name's prefix picks the HTTP method**: `get*`→GET, `post*`→POST,
  `put*`→PUT, `patch*`→PATCH, `delete*`→DELETE. Anything else is a
  compile error (`[MMD-S011]`).
- **Exports must be async functions** — sync functions, constants,
  default exports, and re-exports can't cross the boundary (`[MMD-S003]`).
  A `middleware` export is the one allowed exception.
- **Parameters are named identifiers only** — no destructuring or rest
  args; they define the HTTP contract (`[MMD-S013]`). Default values mark
  a parameter optional.
- **Names are globally unique** — `#server-functions` is one flat barrel,
  so two files can't both export `getUser` (`[MMD-S012]`).

## What the call becomes

- **`get*` → a data source.** Args go in the query string
  (`getStory(7)` → `/_fn/stories/getStory?id=7`). The return is the same
  transparent `ResolvedValue<T>` as `$fetch` — read it directly in markup,
  `$track` it, put it under a `Group`. It's a derivation: reactive args
  refire it.
- **`post*`/`put*`/`patch*`/`delete*` → a mutation.** Args go in the JSON
  body. These **cannot be called during render or module evaluation** —
  the compiler rejects it (`[MMD-S010]`); call them from event handlers,
  effects, or deferred callbacks.

```tsx
const story = getStory(selectedId);   // refetches when selectedId changes
```

## Tracking a call

Because a server-function call returns the same kind of value `$fetch`
returns, it can be `$track`ed exactly the same way — every lifecycle
field (`id`, `pending`, `refreshing`, `error`, `refresh`, `abort`,
`onSuccess`, `onError`) is available. For a mutation, call the function
in the handler and track the **returned value**:

```tsx
import { $track } from '@memoized-dom/data';
import { getStories, postVote } from '#server-functions';

export function App() {
  const stories = getStories();
  const storiesRequest = $track(stories);         // track the read
  let lastVote = null as ReturnType<typeof postVote> | null;

  function vote(id: number) {
    lastVote = postVote(id);                      // mutation fires here
    const tracker = $track(lastVote);             // track that call

    tracker.onSuccess((result) => {
      storiesRequest.refresh();                   // re-run getStories
    });
    tracker.onError(() => {
      // undo optimistic change, show a toast, …
    });
  }

  return (
    <div>
      {storiesRequest.pending ? <p>Loading…</p> : null}
      <ul>
        {stories.map(s => (
          <li key={s.id}>
            {s.title}
            <button onClick={() => vote(s.id)}>Vote</button>
          </li>
        ))}
      </ul>
      {lastVote !== null ? (
        <p>
          {$track(lastVote).pending
            ? 'Recording vote…'
            : $track(lastVote).error !== null
              ? `Vote failed: ${$track(lastVote).error?.message}`
              : 'Vote recorded'}
        </p>
      ) : null}
    </div>
  );
}
```

Each `postVote(id)` call is its own request — `$track` exposes a `request
id`, so `onSuccess`/`onError` callbacks know which invocation settled.
Same tracker shape as [05 — Data](./05-data.md), no new API.

Next: [13 — Server middleware](./13-server-middleware.md)

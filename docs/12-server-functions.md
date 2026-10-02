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

A file in `functions/` whose **annotated or verb-prefixed async exports** become HTTP
endpoints — the filename is the route namespace, the export name finishes
the path (`/_fn/<file>/<name>`):

```ts
// server/functions/stories.ts
/** @GET */
export async function stories() {          // GET  /_fn/stories/stories
  return db.stories.findMany();
}

/** @POST */
export async function vote(id: number) {    // POST /_fn/stories/vote
  return db.stories.vote(id);
}
```

`@GET`, `@POST`, `@PUT`, `@PATCH`, and `@DELETE` select the method independently
of the function name. Existing `get`, `post`, `put`, `patch`, and `delete`
prefixes remain supported as a fallback; an explicit annotation takes precedence
so function names are unrestricted. Attach the JSDoc to the function declaration or its single
variable declaration; local export aliases are supported.

### Function middleware and input validation

```ts
import { requireUser } from '#server/middleware';
import { voteInput } from '#server/validation';
import { json } from '@memoized-dom/server';

/**
 * @POST
 * @middleware [requireUser]
 * @Input voteInput
 */
export async function vote(storyId: number) {
  return json(await db.stories.vote(storyId));
}
```

`@middleware [...]` adds ordinary middleware after inherited folder and file
middleware, in listed order. Imported and private local bindings are supported;
member access, factory calls, and array spreads can be used in the list.
These bindings and their dependencies remain server-only.

The `@memoized-dom/language-service` editor plugin recognizes these annotation
references and checks middleware signatures and schema output types. A binding
used only by a tag counts as used. The editor checks an in-memory copy without
changing source files. Plain `tsc` does not load editor plugins,
so it still treats custom tag references as comments and may report the
imported or local binding as unused. See the
[language-service setup](../packages/language-service/README.md) for editor
compatibility and custom server roots.

`@Input` references a Standard Schema v1 validator for the named argument
object, such as `{ storyId: 42 }`. Middleware runs first; a short-circuit
response skips validation and the handler. The transport decodes input once,
then the schema validates it. GET numbers and booleans are decoded from query
strings before validation. Schemas may supply defaults or transform field
values, but must return an object with the function's argument names and
compatible value types. Optional/defaulted parameters should be optional in
the schema or have a schema default; function defaults run after validation.
Validation issues produce a `400` response with
`error: 'invalid_server_function_input'`, a message, and `issues`.

`json()` uses native JSON serialization. Values received by the client have
ordinary JSON types; dates serialize to strings and are never reconstructed.
Parameterized GET results can be adopted from SSR state during hydration
without another initial fetch. Transfer records identify the complete request
by a fingerprint rather than embedding raw query arguments.

The plugin writes `.memoized/server-functions.d.ts` only when it discovers
server functions, and removes a stale declaration when the last function is
removed. Likewise, `.memoized/routes.d.ts` is generated only for an app with
discovered routes.

And client code just calls them — imported from `#server-functions`,
one flat barrel of every function across all files:

```tsx
// src/App.tsx — client code
import { stories as loadStories, vote } from '#server-functions';

export function App() {
  const stories = loadStories();         // a data source, like $fetch

  return (
    <ul>
      {stories.map(s => (
        <li key={s.id}>
          {s.title}
          <button onClick={() => vote(s.id)}>Vote</button>
        </li>
      ))}
    </ul>
  );
}
```

## The rules

- **The annotation or legacy prefix picks the HTTP method**: `@GET` / `get*`→GET, `@POST` / `post*`→POST,
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

Mutation arguments are sent as a JSON object keyed by parameter name, not a
positional array: `postVote(7)` sends `{"id":7}`.

```tsx
const story = getStory(selectedId);   // refetches when selectedId changes
```

## Status, cookies, and errors

A server function can return a normal Web `Response`, just like an HTTP route.
The optional `json()` helper is a short, typed way to create one:

```ts
import { json } from '@memoized-dom/server';

export async function postLogin(email: string, password: string) {
  const session = await authenticate(email, password);
  if (session === null) {
    return json({ error: 'invalid_credentials' }, { status: 401 });
  }
  return json({ user: session.user }, {
    status: 201,
    headers: { 'set-cookie': session.cookie },
  });
}
```

`json()` returns a native `Response`; it has no special server-function
behavior. Its only extra benefit is TypeScript inference of the JSON body
on generated client calls. It works identically in ordinary routes
(`app.get('/health', () => json({ ok: true }))`) and middleware. Raw
`Response.json()` works too.

The server sends the response unchanged. The browser handles `Set-Cookie`;
the client facade decodes the body as it does for other `$fetch` calls. With
`json()`, the client value retains the JSON body's TypeScript type. With a raw
`Response`, the client value is typed `unknown` because TypeScript cannot
infer its body shape. On a non-2xx response, `$track(call).error` is a
`RequestError` with `status` and
the decoded body in `data`. Unexpected thrown exceptions still go through
`serve({ onError })` rather than exposing their details to clients.

## Mutations return the data — reconcile, don't refetch

A mutation's return value is the server's truth for what it changed.
`postNote` returns the created note, `postVote` returns the new vote count
— use that to patch local state in `onSuccess`, not a second `get*` call:

```ts
const optimistic = { id: 'pending', text, by: 'you' };
notes.push(optimistic);                       // instant UI

lastPost = postNote(expeditionId, text);
$track(lastPost).onSuccess((saved) => {
  notes.splice(notes.indexOf(optimistic), 1, saved);   // swap in the real row
});
$track(lastPost).onError(() => {
  notes.splice(notes.indexOf(optimistic), 1);          // roll back
});
```

Refetching after every mutation would waste a round trip for data you
already have. `refresh()` is for the rarer case — a write that changes
state owned by a *different* source (a count, an aggregate) whose inputs
you can't reconcile locally.

## Tracking a call

Because a server-function call returns the same kind of value `$fetch`
returns, it can be `$track`ed exactly the same way — every lifecycle
field (`id`, `pending`, `refreshing`, `error`, `refresh`, `abort`,
`onSuccess`, `onError`) is available. For a mutation, call the function
in the handler and track the **returned value**:

```tsx
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

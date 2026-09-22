# The server context

Every request `serve()` handles produces one `context` object. Route
handlers and middleware receive it as a parameter — but server functions
don't (their signature is the HTTP contract), so they read it through
`getServerContext()`:

```ts
import { getServerContext } from '@memoized-dom/server';

// server/functions/stories.ts
export async function postVote(id: number) {
  const context = getServerContext();
  // …the active request's context
}
```

## What's on it

| Field | What it is | Comes from |
|---|---|---|
| `request` | The incoming `Request` — headers, cookies, method, body | the request itself |
| `url` | Parsed `URL` — `url.searchParams` for the query | the request itself |
| `params` | Route pattern params (`/api/:id` → `{ id }`) | the matched route |
| `locals` | Your per-request bag — mutable | `createLocals(request)` + middleware writes |
| `services` | Shared app dependencies — db, clients | `createServices()`, once per app |
| `platform` | Host bindings — env, KV, buckets | `createPlatform(request)` / the adapter |

## Examples inside server functions

**Auth via `locals`** — the session middleware already resolved the user;
the function just reads it:

```ts
export async function getProfile() {
  const { locals } = getServerContext();
  if (locals.user === undefined) throw new Error('Not signed in');
  return db.users.find(locals.user);
}
```

**Dependencies via `services`** — initialized once in
`server/config/services.ts`, typed by `ServerTypes`:

```ts
export async function postComment(storyId: number, text: string) {
  const { services, locals } = getServerContext();
  return services.database.comments.create({
    storyId,
    text,
    author: locals.user,
  });
}
```

**Headers/cookies via `request`** — for things locals doesn't capture:

```ts
export async function deleteStory(id: number) {
  const { request } = getServerContext();
  if (request.headers.get('x-admin') !== 'yes') {
    throw new Error('Admins only');
  }
  return db.stories.remove(id);
}
```

**Query/platform** — `url.searchParams` for extra input, `platform` for
host bindings:

```ts
export async function getUsage() {
  const { url, platform } = getServerContext();
  const verbose = url.searchParams.has('verbose');
  return platform?.env.KV.get('usage', { json: verbose });
}
```

## Rules

- **Only during request handling.** `getServerContext()` throws outside a
  `serve()` dispatch — there's no ambient request at module top level or
  in a stray timer.
- **It works the same during SSR.** In-memory dispatch (server rendering)
  and real HTTP populate the same context — code doesn't branch.
- **It's typed by `ServerTypes`** — `locals`/`services`/`platform` carry
  the shapes from `server/config/index.ts`; `context.services.database`
  is checked, not `any`.
- **`params` is the route's params** — server functions mount under
  `/_fn/*`, which has no params of its own, so inside a function `params`
  is empty. Function inputs come through the function's arguments, not
  `params`.

Next: [16 — `$routed`](./16-routed.md)

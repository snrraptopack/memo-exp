# Server routing

Add HTTP endpoints by calling methods on the `serve()` instance:

```ts
const app = serve();

app.get('/api/health', () => ({ ok: true }));

app.get('/api/stories/:id', (context) => {
  const story = findStory(context.params.id);   // string
  return story ?? new Response('Not found', { status: 404 });
});

app.post('/api/stories', async (context) => {
  const body = await context.request.json();
  return createStory(body);                     // → JSON response
});

export default app;
```

All seven verbs exist: `get`, `post`, `put`, `patch`, `delete`, `head`,
`options`. Paths are route patterns — `:param` segments and a terminal
`*` wildcard, same syntax as client `route`.

The handler receives the server `context` — everything `serve()`
produced, plus the request itself:

| Field | |
|---|---|
| `request` | the incoming `Request` — headers, body, method |
| `url` | parsed `URL` — `url.searchParams` for the query string |
| `params` | pattern params — `/api/stories/:id` → `{ id }` |
| `locals` | per-request data from `createLocals` |
| `services` | shared dependencies from `createServices` |
| `platform` | host bindings from `createPlatform` (`undefined` if unset) |

What you return becomes the response:

| Return | Sent as |
|---|---|
| `Response` | as-is — full control of status/headers/body |
| `undefined` | `204 No Content` |
| `string` | `text/plain` |
| `ReadableStream` | streamed body |
| anything else | `Response.json(value)` |

Thrown errors go to `onError` (or a generic 500 without it). One reserved
space: `/_fn/*` is not yours to register — `app.get('/_fn/x', …)` is
rejected.

Next: [12 — Server functions](./12-server-functions.md)

## Reading it from the client

A route is just a URL — the client side reads it with `$fetch` exactly
like any other request:

```ts
// server.ts
app.get('/api/stories', async (context) => {
  return context.services.database.stories.findMany();
});
```

```tsx
// src/App.tsx
import { $fetch } from '@memoized-dom/data';

interface Story {
  id: number;
  title: string;
  votes: number;
}

export function App() {
  const stories = $fetch<Story[]>('/api/stories');

  return (
    <ul>
      {stories.map(s => <li key={s.id}>{s.title} — {s.votes}</li>)}
    </ul>
  );
}
```

Params, query strings, reactive URLs — everything from
[05 — Data](./05-data.md) applies unchanged; the endpoint being your own
`app.get` route changes nothing on the client.

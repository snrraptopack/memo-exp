# The server `config/` folder

The `server/` root holds more than `functions/`. The other conventional
piece is `config/index.ts` — the file that makes `context.locals`,
`context.services`, and `context.platform` **typed everywhere** instead of
`unknown`.

```
server/
  config/
    index.ts       → exports ServerTypes — the app's server contract
    services.ts    → your service factories (db, clients, caches)
    db.ts          → …or split further, your call
  functions/
```

## `ServerTypes` — one interface, project-wide typing

`config/index.ts` must export an interface literally named `ServerTypes`:

```ts
// server/config/index.ts
import type { ApplicationServices } from './services';

export interface ServerTypes {
  locals: {
    requestId: string;
    user?: string;
  };
  services: ApplicationServices;
  platform?: Env;        // optional — only if you use createPlatform
}
```

Three keys, all matching the `serve()` options:

| Key | Types |
|---|---|
| `locals` | `context.locals` — what `createLocals` returns per request |
| `services` | `context.services` — what `createServices` builds once |
| `platform` | `context.platform` — what `createPlatform`/the host provides |

The plugin finds `config/index.ts` inside the configured `server` root,
generates a registry augmentation (`.memoized/server-config.d.ts`), and
from then on every handler, middleware, and server function sees the real
types — `context.services.database` isn't `unknown`, it's your
`ApplicationServices`. Exactly **one** `config/index.*` file may exist.

## Splitting it into real files

`index.ts` is the contract — the implementation can live wherever makes
sense under the root:

```ts
// server/config/services.ts — initialization lives here
export interface ApplicationServices {
  readonly database: Database;
  readonly mailer: Mailer;
}

export async function createServices(): Promise<ApplicationServices> {
  const database = await connectDatabase(process.env.DATABASE_URL!);
  const mailer = createMailer(process.env.SMTP_URL!);
  return { database, mailer };
}
```

```ts
// server.ts — wire the factory into serve()
import { serve } from '@memoized-dom/server';
import { createServices } from '#server/config/services';

const app = serve({
  createLocals: (request) => ({
    requestId: crypto.randomUUID(),
    user: readSession(request.headers.get('cookie')),
  }),
  createServices,          // lazy — runs once, first time services is read
});

export default app;
```

`#server/` imports resolve only inside the server root — the same alias
client code is forbidden from touching.

Now the types line up end to end: `createServices` returns
`ApplicationServices`, `ServerTypes.services` declares it, and every
`context.services` read — routes, middleware, function files — is checked
against it. Change the shape in one place and every consumer is covered.

## Why bother

Without `config/index.ts` everything still *runs* — `locals`/`services`
just type as empty records and you lose autocomplete, refactors, and
mismatch errors. With it, the server context is as typed as the rest of
the app — and the same `ServerTypes` also types the server context given
to `$routed` preparations, which is where this pays off next.

Next: [15 — The server context](./15-server-context.md)

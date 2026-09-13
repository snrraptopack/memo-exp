/**
 * Server entry — the composed application server.
 *
 * This one block demonstrates:
 *
 *   - global middleware       → `logger`, runs for pages, /api/*, and /_fn/*
 *   - request locals          → `session` populates `locals.user` per request
 *   - bare API routes         → `/api/health` (implicit GET, JSON response)
 *   - method-map routes       → `/api/echo` (POST only; other methods 405)
 *   - prefix-group protection → `/api/admin/*` requires the admin header
 *   - server functions        → generated from server/functions/* and
 *                               installed into this router automatically
 *   - page fallthrough        → every other URL server-renders `App`, whose
 *                               $fetch calls dispatch in-memory through
 *                               this same pipeline
 */
import { defineServer, type DefineServerOptions } from '@memoized-dom/server';
import type { ServerMiddleware } from '@memoized-dom/server/router';
import { App } from './App';

interface Locals {
  requestId: string;
  user?: string;
}

let sequence = 0;

const logger: ServerMiddleware<Locals> = async (context, next) => {
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status}`,
  );
  return response;
};

const session: ServerMiddleware<Locals> = (context, next) => {
  context.locals.user = context.request.headers.get('x-user') ?? undefined;
  return next();
};

const requireAdmin: ServerMiddleware<Locals> = (context, next) => {
  if (context.request.headers.get('x-admin') !== 'yes') {
    return new Response('Admins only', { status: 403 });
  }
  return next();
};

const options: DefineServerOptions<Locals> = {
  app: App,
  document: new URL('./index.html', import.meta.url),

  middleware: [logger, session],
  createLocals: () => ({ requestId: `req-${String(++sequence)}` }),

  routes: {
    // Bare handler = implicit GET; object responses serialize to JSON.
    '/api/health': () => ({ ok: true }),

    // Method map: POST only. GET here answers 405 with an Allow header.
    '/api/echo': {
      POST: (context) => ({
        echoed: context.url.pathname,
        requestId: context.locals.requestId,
      }),
    },

    // Middleware-only key = prefix group. It guards the nested route below
    // and composes after the global middleware.
    '/api/admin/*': { middleware: [requireAdmin] },
    '/api/admin/stats': (context) => ({
      admin: context.locals.user ?? 'anonymous',
      requestId: context.locals.requestId,
    }),
  },

  render: {
    mode: 'resolve',
    markers: true,
    delivery: 'stream',
  },
};

export default defineServer(options);

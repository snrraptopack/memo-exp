import { describe, expect, it, vi } from 'vitest';
import {
  createServerFunctionRoutes,
  createServerRouter,
  type ServerMiddleware,
} from '../src/http-router';

async function json(response: Response): Promise<unknown> {
  return response.json();
}

describe('server HTTP router', () => {
  it('mounts named HTTP functions as strict middleware-aware routes', async () => {
    const calls: unknown[][] = [];
    const routeMiddleware = vi.fn(async (_context, next) => {
      const response = await next();
      response.headers.set('x-function-middleware', 'yes');
      return response;
    });
    const routes = createServerFunctionRoutes([{
      id: 'stories/getStory',
      method: 'GET',
      path: '/_fn/stories/getStory',
      parameters: [
        { name: 'id', optional: false, queryKind: 'number' },
        { name: 'preview', optional: true, queryKind: 'boolean' },
        { name: 'tags', optional: false, queryKind: 'string[]' },
      ],
      middleware: [routeMiddleware],
      handler: (...args) => {
        calls.push(args);
        return { args };
      },
    }]);
    const router = createServerRouter({ routes });

    const response = await router.fetch(new Request(
      'https://app.test/_fn/stories/getStory?id=42&preview=true&tags=a&tags=b',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-function-middleware')).toBe('yes');
    expect(await json(response)).toEqual({ args: [42, true, ['a', 'b']] });
    expect(calls).toEqual([[42, true, ['a', 'b']]]);
    expect(routeMiddleware).toHaveBeenCalledOnce();
  });

  it('decodes mutation bodies and reports malformed endpoint input as 400', async () => {
    const handler = vi.fn((id: unknown, reason: unknown) => ({ id, reason }));
    const router = createServerRouter({
      routes: createServerFunctionRoutes([{
        id: 'stories/deleteStory',
        method: 'DELETE',
        path: '/_fn/stories/deleteStory',
        parameters: [
          { name: 'id', optional: false },
          { name: 'reason', optional: true },
        ],
        handler,
      }]),
    });

    const success = await router.fetch(new Request(
      'https://app.test/_fn/stories/deleteStory',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 7 }),
      },
    ));
    expect(await json(success)).toEqual({ id: 7 });
    expect(handler).toHaveBeenCalledWith(7, undefined);

    const malformed = await router.fetch(new Request(
      'https://app.test/_fn/stories/deleteStory',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'duplicate', extra: true }),
      },
    ));
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toEqual({
      error: 'invalid_server_function_input',
      message: "Unknown request body field 'extra'",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps the /_fn namespace exclusive to generated server-function routes', () => {
    expect(() => createServerRouter({
      routes: [{
        method: 'GET',
        path: '/_fn/stories/getStory',
        handler: () => undefined,
      }],
    })).toThrow("reserved server-function namespace '/_fn/*'");
  });

  it('dispatches static and parameterized routes by method', async () => {
    const router = createServerRouter({
      routes: [
        {
          method: 'GET',
          path: '/health',
          handler: () => 'ok',
        },
        {
          method: 'GET',
          path: '/users/:id',
          handler: (context) => ({
            id: context.params.id,
            query: context.url.searchParams.get('view'),
          }),
        },
        {
          method: 'POST',
          path: '/users/:id',
          handler: (context) => Response.json({
            id: context.params.id,
            method: context.request.method,
          }),
        },
      ],
    });

    const health = await router.fetch(new Request('https://app.test/health'));
    expect(await health.text()).toBe('ok');
    expect(health.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    const user = await router.fetch(
      new Request('https://app.test/users/a%20b?view=full'),
    );
    expect(await json(user)).toEqual({ id: 'a b', query: 'full' });

    const created = await router.fetch(new Request('https://app.test/users/42', {
      method: 'POST',
    }));
    expect(await json(created)).toEqual({ id: '42', method: 'POST' });
  });

  it('implements HEAD fallback, automatic OPTIONS, and method diagnostics', async () => {
    const get = vi.fn(() => new Response('body', {
      headers: { 'x-route': 'get' },
    }));
    const router = createServerRouter({
      routes: [
        { method: 'GET', path: '/items', handler: get },
        { method: 'POST', path: '/items', handler: () => ({ created: true }) },
      ],
    });

    const head = await router.fetch(new Request('https://app.test/items', {
      method: 'HEAD',
    }));
    expect(head.status).toBe(200);
    expect(head.headers.get('x-route')).toBe('get');
    expect(await head.text()).toBe('');
    expect(get).toHaveBeenCalledOnce();

    const options = await router.fetch(new Request('https://app.test/items', {
      method: 'OPTIONS',
    }));
    expect(options.status).toBe(204);
    expect(options.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');

    const rejected = await router.fetch(new Request('https://app.test/items', {
      method: 'PATCH',
    }));
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
  });

  it('composes global, prefix, and route middleware as an onion', async () => {
    interface Locals { user?: string; }
    const events: string[] = [];
    const layer = (name: string): ServerMiddleware<Locals> =>
      async (_context, next) => {
        events.push(`${name}:in`);
        const response = await next();
        events.push(`${name}:out`);
        response.headers.set(`x-${name}`, 'yes');
        return response;
      };
    const router = createServerRouter<Locals>({
      createLocals: () => ({}),
      middleware: [layer('global')],
      groups: [
        { path: '/api/*', middleware: [layer('api')] },
        {
          path: '/api/admin/*',
          middleware: [
            async (context, next) => {
              context.locals.user = 'Ada';
              return layer('admin')(context, next);
            },
          ],
        },
      ],
      routes: [{
        method: 'GET',
        path: '/api/admin/users/:id',
        middleware: [layer('route')],
        handler: (context) => {
          events.push('handler');
          return { id: context.params.id, user: context.locals.user };
        },
      }],
    });

    const response = await router.fetch(
      new Request('https://app.test/api/admin/users/1'),
    );

    expect(await json(response)).toEqual({ id: '1', user: 'Ada' });
    expect(events).toEqual([
      'global:in',
      'api:in',
      'admin:in',
      'route:in',
      'handler',
      'route:out',
      'admin:out',
      'api:out',
      'global:out',
    ]);
    expect(response.headers.get('x-global')).toBe('yes');
    expect(response.headers.get('x-api')).toBe('yes');
    expect(response.headers.get('x-admin')).toBe('yes');
    expect(response.headers.get('x-route')).toBe('yes');
  });

  it('runs matching page middleware before the fallback handler', async () => {
    const router = createServerRouter<{ authenticated: boolean }>({
      createLocals: () => ({ authenticated: false }),
      groups: [{
        path: '/admin/*',
        middleware: [async (context, next) => context.locals.authenticated
          ? next()
          : new Response('Unauthorized', { status: 401 })],
      }],
      routes: [],
      fallback: (context) => `page:${context.url.pathname}`,
    });

    const protectedPage = await router.fetch(
      new Request('https://app.test/admin/dashboard'),
    );
    expect(protectedPage.status).toBe(401);

    const page = await router.fetch(new Request('https://app.test/about'));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('page:/about');
  });

  it('reuses request locals and platform for derived in-memory dispatch', async () => {
    interface Locals { trace: string; }
    interface Platform { region: string; }
    const router = createServerRouter<Locals, Platform>({
      createLocals: () => ({ trace: 'external' }),
      createPlatform: () => ({ region: 'default' }),
      routes: [{
        method: 'GET',
        path: '/context',
        handler: (context) => ({
          trace: context.locals.trace,
          region: context.platform?.region,
        }),
      }],
    });

    const response = await router.dispatch(
      new Request('https://app.test/context'),
      {
        locals: { trace: 'parent-request' },
        platform: { region: 'edge' },
      },
    );
    expect(await json(response)).toEqual({
      trace: 'parent-request',
      region: 'edge',
    });
  });

  it('routes failures through one error boundary', async () => {
    const router = createServerRouter({
      routes: [{
        method: 'GET',
        path: '/broken',
        handler: () => {
          throw new Error('database unavailable');
        },
      }],
      onError: (error, context) => Response.json({
        message: error instanceof Error ? error.message : String(error),
        path: context.url.pathname,
      }, { status: 503 }),
    });

    const response = await router.fetch(new Request('https://app.test/broken'));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      message: 'database unavailable',
      path: '/broken',
    });
  });

  it('rejects ambiguous method tables during startup', () => {
    expect(() => createServerRouter({
      routes: [
        { method: 'GET', path: '/users/:id', handler: () => undefined },
        { method: 'get', path: '/users/:name', handler: () => undefined },
      ],
    })).toThrow('Invalid GET route table');
  });
});

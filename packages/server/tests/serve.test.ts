// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  getServerContext,
  serve,
  type ServerMiddleware,
} from '../src/index';
import {
  createServerFunctionRoutes,
  type ServerRoute,
} from '../src/http-router';
import { compileFixture } from './parity-harness';

interface InstallableApplication<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
  TServices extends object = Record<string, never>,
> {
  installServerFunctions(
    routes: readonly ServerRoute<TLocals, TPlatform, TServices>[],
  ): void;
  installDocumentTemplate(template: string): void;
}

function internals<
  TLocals extends object,
  TPlatform,
  TServices extends object = Record<string, never>,
>(
  app: object,
): InstallableApplication<TLocals, TPlatform, TServices> {
  return app as InstallableApplication<TLocals, TPlatform, TServices>;
}

describe('serve', () => {
  it('composes typed routes, request context, and middleware in declaration order', async () => {
    type Locals = { requestId: string; user?: string };
    type Platform = { region: string };
    const events: string[] = [];
    const logger: ServerMiddleware<Locals, Platform> = async (context, next) => {
      events.push(`global:before:${context.locals.requestId}`);
      const response = await next();
      events.push(`global:after:${response.status}`);
      return response;
    };
    const api: ServerMiddleware<Locals, Platform> = async (_context, next) => {
      events.push('api:before');
      const response = await next();
      events.push('api:after');
      return response;
    };
    const local: ServerMiddleware<Locals, Platform> = (context, next) => {
      context.locals.user = 'Ada';
      events.push('local');
      return next();
    };

    const app = serve<Locals, Platform>({
      createLocals: () => ({ requestId: 'request-1' }),
      createPlatform: () => ({ region: 'local' }),
    });
    app.use(logger);
    app.use('/api/*', api);
    app.get('/api/stories/:id', local, (context) => {
      return {
        id: context.params.id,
        requestId: context.locals.requestId,
        user: context.locals.user,
        region: context.platform?.region,
      };
    });

    const response = await app.fetch(
      new Request('https://app.test/api/stories/42'),
    );
    await expect(response.json()).resolves.toEqual({
      id: '42',
      requestId: 'request-1',
      user: 'Ada',
      region: 'local',
    });
    expect(events).toEqual([
      'global:before:request-1',
      'api:before',
      'local',
      'api:after',
      'global:after:200',
    ]);
  });

  it('registers every supported HTTP verb through its named method', async () => {
    const app = serve();

    expect(app.get('/verbs', () => 'GET')).toBe(app);
    expect(app.post('/verbs', () => 'POST')).toBe(app);
    expect(app.put('/verbs', () => 'PUT')).toBe(app);
    expect(app.patch('/verbs', () => 'PATCH')).toBe(app);
    expect(app.delete('/verbs', () => 'DELETE')).toBe(app);
    expect(app.head('/verbs', () => new Response(null, {
      headers: { 'x-route-method': 'HEAD' },
    }))).toBe(app);
    expect(app.options('/verbs', () => 'OPTIONS')).toBe(app);

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await app.fetch(new Request('https://app.test/verbs', {
        method,
      }));
      expect(await response.text()).toBe(method);
    }

    const head = await app.fetch(new Request('https://app.test/verbs', {
      method: 'HEAD',
    }));
    expect(head.headers.get('x-route-method')).toBe('HEAD');
    expect(await head.text()).toBe('');
  });

  it('installs generated server functions into the same request pipeline', async () => {
    type Locals = { requestId: string };
    const app = serve<Locals>({
      createLocals: () => ({ requestId: 'request-7' }),
    });
    const serverFunctions = createServerFunctionRoutes<Locals>([{
      id: 'stories/getStory',
      method: 'GET',
      path: '/_fn/stories/getStory',
      parameters: [{ name: 'id', optional: false, queryKind: 'number' }],
      handler: (id) => ({
        id,
        title: `Story ${String(id)}`,
        requestId: getServerContext<Locals>().locals.requestId,
      }),
    }]);
    internals<Locals, unknown>(app).installServerFunctions(serverFunctions);

    const response = await app.fetch(new Request(
      'https://app.test/_fn/stories/getStory?id=7',
    ));
    await expect(response.json()).resolves.toEqual({
      id: 7,
      title: 'Story 7',
      requestId: 'request-7',
    });
  });

  it('initializes typed application services once and shares them across requests', async () => {
    type Locals = { requestId: string };
    type Services = {
      database: { readonly name: string };
    };
    const createServices = vi.fn(async (): Promise<Services> => ({
      database: { name: 'stories' },
    }));
    const app = serve<Locals, unknown, Services>({
      createLocals: () => ({ requestId: crypto.randomUUID() }),
      createServices,
    });
    app.get('/api/service', context => ({
      database: context.services.database.name,
      activeDatabase: getServerContext<Locals, unknown, Services>()
        .services.database.name,
    }));

    const responses = await Promise.all([
      app.fetch(new Request('https://app.test/api/service')),
      app.fetch(new Request('https://app.test/api/service')),
    ]);

    await expect(Promise.all(responses.map(response => response.json())))
      .resolves.toEqual([
        { database: 'stories', activeDatabase: 'stories' },
        { database: 'stories', activeDatabase: 'stories' },
      ]);
    expect(createServices).toHaveBeenCalledTimes(1);
  });

  it('renders a global SSR root and path-scoped roots through one application', async () => {
    const global = await compileFixture('serve-global', `
      export function App() {
        return <main><h1>Global</h1></main>;
      }
    `);
    const reports = await compileFixture('serve-reports', `
      export function Reports() {
        return <main><h1>Reports</h1></main>;
      }
    `);
    const app = serve();
    app.ssr(global.serverModule.App);
    app.ssr('/reports/*', reports.serverModule.Reports);
    internals(app).installDocumentTemplate(
      '<!doctype html><body><!--ssr-outlet--></body>',
    );

    const globalResponse = await app.fetch(
      new Request('https://app.test/dashboard'),
    );
    expect(await globalResponse.text()).toContain('<h1>Global</h1>');

    const reportsResponse = await app.fetch(
      new Request('https://app.test/reports/weekly'),
    );
    expect(await reportsResponse.text()).toContain('<h1>Reports</h1>');
  });

  it('rejects duplicate SSR fallbacks and ambiguous scoped registrations', () => {
    const app = serve();
    const component = vi.fn();
    app.ssr(component);
    expect(() => app.ssr(component)).toThrow('fallback is already registered');

    app.ssr('/stories/:id', component);
    expect(() => app.ssr('/stories/:slug', component)).toThrow(
      'Ambiguous routes',
    );
  });
});

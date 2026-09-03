// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  defineServer,
  getServerContext,
} from '../src/define-server';
import { createServerFunctionRoutes } from '../src/http-router';
import { compileFixture } from './parity-harness';

describe('defineServer', () => {
  it('contextually types implicit GET and explicit method handlers', async () => {
    const handler = defineServer({
      createLocals: () => ({ userId: 'user-1' }),
      createPlatform: () => ({ region: 'local' as const }),
      routes: {
        '/implicit': (context) => {
          expect(context.locals.userId).toBe('user-1');
          expect(context.platform?.region).toBe('local');
          return { method: context.request.method };
        },
        '/explicit': {
          POST: (context) => ({
            userId: context.locals.userId,
            region: context.platform?.region,
          }),
        },
      },
    });

    await expect(
      handler(new Request('https://app.test/implicit')).then(value => value.json()),
    ).resolves.toEqual({ method: 'GET' });
    await expect(handler(new Request('https://app.test/explicit')))
      .resolves.toMatchObject({ status: 405 });
  });

  it('normalizes method routes and preserves request locals and platform context', async () => {
    const handler = defineServer<
      { requestId: string },
      { region: string }
    >({
      createLocals: () => ({ requestId: 'request-1' }),
      createPlatform: () => ({ region: 'local' }),
      routes: {
        '/context': {
          POST: () => {
            const context = getServerContext<
              { requestId: string },
              { region: string }
            >();
            return {
              requestId: context.locals.requestId,
              region: context.platform?.region,
            };
          },
        },
      },
    });

    const wrongMethod = await handler(new Request('https://app.test/context'));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toContain('POST');

    const response = await handler(new Request('https://app.test/context', {
      method: 'POST',
    }));
    await expect(response.json()).resolves.toEqual({
      requestId: 'request-1',
      region: 'local',
    });
  });

  it('mounts generated server-function routes in the same router', async () => {
    const serverFunctions = createServerFunctionRoutes([{
      id: 'stories/getStory',
      method: 'GET',
      path: '/_fn/stories/getStory',
      parameters: [{ name: 'id', optional: false, queryKind: 'number' }],
      handler: (id) => ({ id, title: `Story ${String(id)}` }),
    }]);
    const handler = defineServer({ serverFunctions });

    const response = await handler(new Request(
      'https://app.test/_fn/stories/getStory?id=7',
    ));
    await expect(response.json()).resolves.toEqual({
      id: 7,
      title: 'Story 7',
    });
  });

  it('renders buffered clean HTML without a hydration payload', async () => {
    const tiers = await compileFixture('define-buffered', `
      export function App() {
        return <main><h1>Buffered</h1></main>;
      }
    `);
    const handler = defineServer({
      app: tiers.serverModule.App,
      documentTemplate: '<!doctype html><body><!--ssr-outlet--></body>',
      render: { delivery: 'buffer', markers: false },
    });

    const response = await handler(new Request('https://app.test/'));
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toBe(
      '<!doctype html><body><main><h1>Buffered</h1></main></body>',
    );
    expect(html).not.toContain('application/mmd+json');
  });

  it('streams the document around hydratable application output', async () => {
    const tiers = await compileFixture('define-streamed', `
      export function App() {
        return <main><h1>Streamed</h1></main>;
      }
    `);
    const handler = defineServer({
      app: tiers.serverModule.App,
      documentTemplate: '<!doctype html><body><!--ssr-outlet--></body>',
    });

    const response = await handler(new Request('https://app.test/'));
    const html = await response.text();
    expect(html).toContain('<!--mmd:r:App-->');
    expect(html).toContain('<main><h1>Streamed</h1></main>');
    expect(html).toContain('type="application/mmd+json"');
    expect(html.endsWith('</body>')).toBe(true);
  });

  it('dispatches SSR $fetch calls in-process with the request context', async () => {
    const tiers = await compileFixture('define-server-fetch', `
      import { $fetch } from '@memoized-dom/data';
      export function App() {
        const status = $fetch('/api/status');
        return <main>{status.message}</main>;
      }
    `);
    const externalFetch = vi.fn(() => Promise.reject(
      new Error('same-origin route escaped to the network'),
    ));
    const handler = defineServer<{ requestId: string }>({
      app: tiers.serverModule.App,
      documentTemplate: '<!doctype html><body><!--ssr-outlet--></body>',
      createLocals: () => ({ requestId: 'request-7' }),
      fetch: externalFetch as typeof globalThis.fetch,
      routes: {
        '/api/status': () => {
          const { locals } = getServerContext<{ requestId: string }>();
          return { message: `ready:${locals.requestId}` };
        },
      },
      render: { delivery: 'buffer', markers: false },
    });

    const response = await handler(new Request('https://app.test/dashboard'));
    expect(await response.text()).toContain('<main>ready:request-7</main>');
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it('validates document configuration while defining the server', () => {
    const app = vi.fn();
    expect(() => defineServer({ app })).toThrow(
      'requires `document` or `documentTemplate`',
    );
    expect(() => defineServer({
      app,
      document: './index.html',
      documentTemplate: '<!--ssr-outlet-->',
    })).toThrow('either `document` or `documentTemplate`, not both');
    expect(() => defineServer({
      app,
      documentTemplate: '<main></main>',
    })).toThrow('missing the <!--ssr-outlet--> marker');
    expect(() => defineServer({
      app,
      documentTemplate:
        '<!--ssr-outlet--><main></main><!--ssr-outlet-->',
    })).toThrow('contains more than one <!--ssr-outlet--> marker');
    expect(() => defineServer({
      routes: {
        '/ambiguous': {
          handler: () => 'implicit',
          POST: () => 'explicit',
        },
      },
    })).toThrow('cannot combine an implicit GET handler');
  });
});

/**
 * Exercises the Vite 8 adapter through Rolldown build and dev transforms.
 */
import { join, resolve } from 'node:path';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  build,
  createServer,
  type ViteDevServer,
} from 'vite';
import memoizedDom, { memoizedDomFullstack } from '../src';
import { createServerRouter } from '../../server/src/http-router';

const fixture = resolve(import.meta.dirname, 'fixtures/vite-app');
const source = resolve(fixture, 'src');
const runtime = resolve(import.meta.dirname, '../../runtime/src/index.ts');
const runtimeHot = resolve(import.meta.dirname, '../../runtime/src/hot.ts');
const data = resolve(import.meta.dirname, '../../data/src/index.ts');
const dataInternal = resolve(import.meta.dirname, '../../data/src/internal.ts');
const serverRouter = resolve(import.meta.dirname, '../../server/src/http-router.ts');
let server: ViteDevServer | undefined;
let temporaryFixture: string | undefined;

function plugins() {
  return [
    memoizedDom({
      entries: 'src/main.ts',
    }),
  ];
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (temporaryFixture !== undefined) {
    await rm(temporaryFixture, { recursive: true, force: true });
    temporaryFixture = undefined;
  }
});

async function copyFixture(): Promise<string> {
  temporaryFixture = await mkdtemp(join(tmpdir(), 'memoized-dom-vite-'));
  await cp(fixture, temporaryFixture, { recursive: true });
  return temporaryFixture;
}

describe('Vite 8 adapter', () => {
  it('builds an aliased connected graph through Rolldown', async () => {
    const result = await build({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: plugins(),
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: resolve(source, 'main.ts'),
        },
      },
    });
    const builds = Array.isArray(result) ? result : [result];
    const code = builds
      .flatMap((item) => item.output)
      .flatMap((output) =>
        output.type === 'chunk' ? [output.code] : [],
      )
      .join('\n');

    expect(code).toContain('Increment');
    expect(code).toContain('./src/state.ts#count');
    expect(code).toContain('document.createElement("button")');
    expect(code).not.toMatch(/<[A-Za-z][^>]*>/);
    expect(code).not.toContain('registerHotComponent');
    expect(code).not.toContain('import.meta.hot.accept(');
  });

  it('builds a mixed graph containing an experimental TSRX component', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    await rm(resolve(temporarySource, 'App.tsx'));
    await writeFile(
      resolve(temporarySource, 'main.ts'),
      `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './App.tsrx';
        mount('root', App);
      `,
    );
    await writeFile(
      resolve(temporarySource, 'App.tsrx'),
      `
        import { items } from './state';
        export function App() @{
          <main class="list">
            <style>.list { color: red; }</style>
            @for (const item of items; key item) {
              <span>{item}</span>
            } @empty {
              <em>Empty</em>
            }
          </main>
        }
      `,
    );

    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': temporarySource,
          '@memoized-dom/runtime/hot': runtimeHot,
          '@memoized-dom/runtime': runtime,
        },
      },
      plugins: [memoizedDom({ entries: 'src/main.ts' })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    });
    const builds = Array.isArray(result) ? result : [result];
    const code = builds
      .flatMap((item) => item.output)
      .flatMap((output) => output.type === 'chunk' ? [output.code] : [])
      .join('\n');
    const css = builds
      .flatMap((item) => item.output)
      .flatMap((output) => output.type === 'asset' && output.fileName.endsWith('.css')
        ? [String(output.source)]
        : [])
      .join('\n');

    expect(code).toContain('createListRegion');
    expect(code).toContain('createCondRegion');
    expect(code).not.toContain('@for');
    expect(css).toContain('color: red');
    expect(code).not.toContain('color: red');
  });

  it('isolates server implementations, lowers client facades, and mounts real middleware routes', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    const functions = resolve(root, 'server/functions');
    await mkdir(functions, { recursive: true });
    await writeFile(resolve(functions, '_middleware.ts'), `
      export const middleware = [async (_context, next) => {
        const response = await next();
        response.headers.set('x-directory', 'yes');
        return response;
      }];
    `);
    await writeFile(resolve(functions, 'stories.ts'), `
      import { readFile } from 'node:fs/promises';
      const SERVER_SECRET = 'must-not-enter-client';
      export const middleware = [async (_context, next) => {
        const response = await next();
        response.headers.set('x-module', SERVER_SECRET);
        return response;
      }];
      export async function getStory(id: number) {
        if (false) await readFile('secret');
        return { id, title: 'Story ' + id };
      }
      export async function postVote(id: number) {
        return { id, votes: 1 };
      }
    `);
    await writeFile(resolve(temporarySource, 'App.tsx'), `
      import { getStory, postVote } from '#server-functions';
      export function App() {
        const story = getStory(7);
        return <main>
          <h1>{story.title}</h1>
          <button onClick={() => postVote(story.id)}>Vote</button>
        </main>;
      }
    `);

    const aliases = {
      '@': temporarySource,
      '@memoized-dom/runtime/hot': runtimeHot,
      '@memoized-dom/runtime': runtime,
      '@memoized-dom/data/internal': dataInternal,
      '@memoized-dom/data': data,
      '@memoized-dom/server/router': serverRouter,
    };
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: aliases },
      plugins: [memoizedDom({ entries: 'src/main.ts' })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    });
    const builds = Array.isArray(result) ? result : [result];
    const code = builds
      .flatMap(item => item.output)
      .flatMap(output => output.type === 'chunk' ? [output.code] : [])
      .join('\n');

    expect(code).toContain('/_fn/stories/getStory');
    expect(code).toContain('/_fn/stories/postVote');
    expect(code).toContain('readResolvedValuesForRender');
    expect(code).not.toContain('must-not-enter-client');
    expect(code).not.toContain('node:fs/promises');

    const declarations = resolve(root, '.memoized', 'server-functions.d.ts');
    const declarationSource = await readFile(declarations, 'utf8');
    expect(declarationSource).toContain(
      'import type { ResolvedValue } from "@memoized-dom/data"',
    );
    expect(declarationSource).toContain(
      'import type * as __mmd_impl_0 from "../server/functions/stories.js"',
    );
    expect(declarationSource).toContain(
      'export declare function getStory(...args: Parameters<typeof __mmd_impl_0.getStory>): ResolvedValue<Awaited<ReturnType<typeof __mmd_impl_0.getStory>>>;',
    );

    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: aliases },
      plugins: [memoizedDom({ entries: 'src/main.ts' })],
      server: { middlewareMode: true },
    });
    const generated = await server.ssrLoadModule(
      'virtual:memoized-dom/server-functions',
    ) as { serverFunctionRoutes: Parameters<typeof createServerRouter>[0]['routes'] };
    const router = createServerRouter({ routes: generated.serverFunctionRoutes });
    const response = await router.fetch(new Request(
      'https://app.test/_fn/stories/getStory?id=9',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-directory')).toBe('yes');
    expect(response.headers.get('x-module')).toBe('must-not-enter-client');
    await expect(response.json()).resolves.toEqual({ id: 9, title: 'Story 9' });
  }, 30_000);

  it('lowers module state into request-owned cells when opted in', async () => {
    const result = await build({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: [
        memoizedDom({ entries: 'src/main.ts', moduleStateCells: true }),
      ],
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: resolve(source, 'main.ts'),
        },
      },
    });
    const builds = Array.isArray(result) ? result : [result];
    const code = builds
      .flatMap((item) => item.output)
      .flatMap((output) => (output.type === 'chunk' ? [output.code] : []))
      .join('\n');

    // Owner records its authored default; importer references the same
    // identity without one; compound writes lower to functional updates.
    // (Rolldown renames bundled runtime identifiers, so anchor on the
    // canonical keys and value shapes, not _MD member names.)
    expect(code).toContain('./src/state.ts#count", 0)');
    expect(code).toContain('./src/state.ts#count")');
    expect(code).toContain('(c) => c + 1');
    expect(code).not.toMatch(/_value = count\b/);
  });

  it('serves generated modules from the on-demand dev pipeline', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: plugins(),
      server: { middlewareMode: true },
    });

    const main =
      await server.environments.client.transformRequest('/src/main.ts');
    const app =
      await server.environments.client.transformRequest('/src/App.tsx');
    const label =
      await server.environments.client.transformRequest('/src/Label.tsx');
    const state =
      await server.environments.client.transformRequest('/src/state.ts');
    const row =
      await server.environments.client.transformRequest('/src/Row.tsx');
    const panel =
      await server.environments.client.transformRequest('/src/Panel.tsx');

    expect(main?.code).toMatch(/mount\(["']root["'], App\)/);
    expect(main?.code).not.toContain('import.meta.hot.accept(');
    expect(app?.code).toContain('function App(_id');
    expect(app?.map).not.toBeNull();
    expect(app?.map?.sources.some((id) => id.endsWith('/src/App.tsx'))).toBe(true);
    expect(app?.map?.sourcesContent?.some((content) => content?.includes('function App()'))).toBe(true);
    expect(app?.code).toContain('Label(_id');
    expect(label?.code).toContain('function Label(_id');
    expect(state?.code).toContain('commitWrites');
    expect(row?.code).toContain('./src/state.ts#selected');
    expect(row?.code).toContain('commitWrites');
    expect(row?.code).not.toContain('markDirtySubtree');
    expect(panel?.code).toContain('./src/state.ts#selected');
    expect(panel?.code).toContain('markDirty');
    expect(panel?.code).toContain('commitWrites');
    expect(panel?.code).not.toContain('markDirtySubtree');
    expect(app?.code).toContain('registerHotComponent');
    expect(app?.code).toContain('import.meta.hot.accept(');
  });

  it('serves one coherent lazy graph when the configured seed is missing', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: [memoizedDom({ entries: 'src/missing.ts' })],
      server: { middlewareMode: true },
    });

    // Request order matches a browser: the mount module is transformed
    // first, then its imported component modules. Imported modules must
    // reuse the mount module's linked graph rather than compiling as
    // independent application roots.
    const main =
      await server.environments.client.transformRequest('/src/main.ts');
    const app =
      await server.environments.client.transformRequest('/src/App.tsx');

    expect(main?.code).toMatch(/mount\(["']root["'], App\)/);
    expect(app?.code).toContain('function App(_id');
    expect(app?.code).toContain('registerHotComponent');
    expect(app?.code).toContain('import.meta.hot.accept(');
  });

  it('recompiles edits and emits an HMR update without a page reload', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': temporarySource,
          '@memoized-dom/runtime/hot': runtimeHot,
          '@memoized-dom/runtime': runtime,
        },
      },
      plugins: plugins(),
      server: { middlewareMode: true },
    });
    await server.environments.client.transformRequest('/src/App.tsx');

    const hot = server.environments.client.hot;
    const send = vi.spyOn(hot, 'send').mockImplementation(() => {});
    const appFile = resolve(temporarySource, 'App.tsx');
    const app = await readFile(appFile, 'utf8');
    await writeFile(appFile, app.replace('Increment</button>', 'Increase</button>'));

    await vi.waitFor(
      () => {
        expect(send).toHaveBeenCalled();
      },
      { timeout: 15_000 },
    );
    expect(send.mock.calls.some(([payload]) => payload.type === 'full-reload'))
      .toBe(false);
    expect(send.mock.calls.some(([payload]) => payload.type === 'update'))
      .toBe(true);
  }, 30_000);

  it('sends compiler failures from an edit to Vite error feedback', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': temporarySource,
          '@memoized-dom/runtime/hot': runtimeHot,
          '@memoized-dom/runtime': runtime,
        },
      },
      plugins: plugins(),
      server: { middlewareMode: true },
    });
    await server.environments.client.transformRequest('/src/App.tsx');

    const hot = server.environments.client.hot;
    const send = vi.spyOn(hot, 'send').mockImplementation(() => {});
    const appFile = resolve(temporarySource, 'App.tsx');
    const app = await readFile(appFile, 'utf8');
    const invalid = app
      .replace(
        "import { Row } from './Row';",
        "import { Row } from './Row';\nlet local = 0;\nconst double = local * 2;",
      )
      .replace(
        '<button onClick={increment}>',
        '<button onClick={() => { local++; double++; }}>',
      );
    await writeFile(appFile, invalid);

    await vi.waitFor(
      () => {
        expect(
          send.mock.calls.some(
            ([payload]) =>
              payload.type === 'error' &&
              payload.err.message.includes("cannot update computed 'double'") &&
              payload.err.loc?.line !== undefined,
          ),
        ).toBe(true);
      },
      { timeout: 15_000 },
    );

    send.mockClear();
    await writeFile(appFile, app);
    await vi.waitFor(
      () => {
        expect(
          send.mock.calls.some(([payload]) => payload.type === 'update'),
        ).toBe(true);
      },
      { timeout: 15_000 },
    );
    expect(send.mock.calls.some(([payload]) => payload.type === 'full-reload'))
      .toBe(false);
  }, 30_000);
  it('serves Web handlers through first-class fullstack dev middleware', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      plugins: [
        ...plugins(),
        memoizedDomFullstack({ entry: 'src/server.ts' }),
      ],
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Expected Vite TCP server address');
    }

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const document = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(document.headers.get('content-type')).toContain('text/html');
    await expect(document.text()).resolves.toBe(
      '<!doctype html><h1>Fullstack</h1>',
    );
  });

});

/**
 * Exercises the Vite 8 adapter through Rolldown build and dev transforms.
 */
import { join, resolve } from 'node:path';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  build,
  createServer,
  type ViteDevServer,
} from 'vite';
import memoizedDom from '../src';

const fixture = resolve(import.meta.dirname, 'fixtures/vite-app');
const source = resolve(fixture, 'src');
const runtime = resolve(import.meta.dirname, '../../runtime/src/index.ts');
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
        '<button onClick={() => double++}>',
      );
    await writeFile(appFile, invalid);

    await vi.waitFor(
      () => {
        expect(
          send.mock.calls.some(
            ([payload]) =>
              payload.type === 'error' &&
              payload.err.message.includes("cannot update computed 'double'"),
          ),
        ).toBe(true);
      },
      { timeout: 15_000 },
    );
  }, 30_000);
});

/**
 * Exercises the Vite 8 adapter through Rolldown build and dev transforms.
 */
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  build,
  createServer,
  type ViteDevServer,
} from 'vite';
import memoizedDom from '../src';

const fixture = resolve(import.meta.dirname, 'fixtures/vite-app');
const source = resolve(fixture, 'src');
let server: ViteDevServer | undefined;

function plugins() {
  return [
    memoizedDom({
      entries: 'src/App.tsx',
      rootId: 'App',
    }),
  ];
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

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

    expect(app?.code).toContain('function App(_id');
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
  });

  it('invalidates the managed graph and requests a full reload', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: plugins(),
      server: { middlewareMode: true },
    });
    await server.environments.client.transformRequest('/src/App.tsx');

    const hot = server.environments.client.hot;
    const send = vi.spyOn(hot, 'send').mockImplementation(() => {});
    server.watcher.emit('change', resolve(source, 'state.ts'));

    await vi.waitFor(
      () => {
        expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
      },
      { timeout: 5_000 },
    );

    const state =
      await server.environments.client.transformRequest('/src/state.ts');
    expect(state?.code).toContain('commitWrites');
  });
});

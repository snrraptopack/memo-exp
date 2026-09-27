import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import memoizedDom from '../src';

const repository = resolve(import.meta.dirname, '../../..');
const runtime = resolve(repository, 'packages/runtime/src/index.ts');
const runtimeHot = resolve(repository, 'packages/runtime/src/hot.ts');
const runtimeHydrate = resolve(repository, 'packages/runtime/src/hydrate.ts');
const runtimeServer = resolve(repository, 'packages/runtime/src/server.ts');
const data = resolve(repository, 'packages/data/src/index.ts');
const dataInternal = resolve(repository, 'packages/data/src/internal.ts');
const router = resolve(repository, 'packages/router/src/index.ts');
const routerInternal = resolve(repository, 'packages/router/src/internal.ts');
const serverIndex = resolve(repository, 'packages/server/src/index.ts');
const serverRouter = resolve(repository, 'packages/server/src/http-router.ts');

let vite: ViteDevServer | undefined;
let fixture: string | undefined;

afterEach(async () => {
  await vite?.close();
  vite = undefined;
  if (fixture !== undefined) {
    await rm(fixture, { recursive: true, force: true });
    fixture = undefined;
  }
});

describe('fullstack SSR request isolation', () => {
  it('isolates module state mutated through an imported helper by default', async () => {
    fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-ssr-isolation-'));
    await writeFile(resolve(fixture, 'index.html'), `
      <!doctype html><html><body>
        <div id="root"><!--ssr-outlet--></div>
        <script type="module" src="/main.ts"></script>
      </body></html>
    `);
    await writeFile(resolve(fixture, 'probe.ts'), `
      export let ssrRenderCount = 0;
      export function bumpSsr(): number {
        ssrRenderCount += 1;
        return ssrRenderCount;
      }
    `);
    await writeFile(resolve(fixture, 'App.tsx'), `
      import { bumpSsr, ssrRenderCount } from './probe';
      export function App() {
        bumpSsr();
        return <main data-ssr-probe>{ssrRenderCount}</main>;
      }
    `);
    await writeFile(resolve(fixture, 'main.ts'), `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';
      mount('root', App);
    `);
    await writeFile(resolve(fixture, 'server.ts'), `
      import { serve } from '@memoized-dom/server';
      import { App } from './App';
      const app = serve();
      app.ssr(App);
      export default app;
    `);

    vite = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: [
          { find: '@memoized-dom/runtime/server', replacement: runtimeServer },
          { find: '@memoized-dom/runtime/hot', replacement: runtimeHot },
          { find: '@memoized-dom/runtime/hydrate', replacement: runtimeHydrate },
          { find: '@memoized-dom/runtime', replacement: runtime },
          { find: '@memoized-dom/data/internal', replacement: dataInternal },
          { find: '@memoized-dom/data', replacement: data },
          { find: '@memoized-dom/router/internal', replacement: routerInternal },
          { find: '@memoized-dom/router', replacement: router },
          { find: '@memoized-dom/server/router', replacement: serverRouter },
          { find: '@memoized-dom/server', replacement: serverIndex },
        ],
      },
      plugins: [memoizedDom({ clientEntry: 'main.ts', serverEntry: 'server.ts' })],
      server: { host: '127.0.0.1', port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Expected a Vite TCP server address');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    for (let request = 0; request < 3; request++) {
      const response = await fetch(origin);
      const html = await response.text();
      expect(response.status, html).toBe(200);
      expect(html).toContain('<main data-ssr-probe="true">1</main>');
    }
  }, 30_000);
});

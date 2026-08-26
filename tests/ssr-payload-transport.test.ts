import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToResult, renderToResultAsync } from '@memoized-dom/server';
import { hydrate, registerRootFactory, resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'ssr-payload-transport.compiled.ts');

const modules = {
  './app.tsx': `
    import { $fetch, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';

    function Skeleton() {
      return <div class="skeleton">Loading...</div>;
    }

    function ErrorView({ error, retry }: { error: { message: string }; retry: () => void }) {
      return <div class="error">{error.message}</div>;
    }

    export function App() {
      const user = $fetch('/api/user');
      return (
        <section>
          <Group data={user}>
            <Pending component={Skeleton} />
            <ErrorArm component={ErrorView} />
            <h1>{user.name}</h1>
          </Group>
        </section>
      );
    }
  `,
};

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
const compiled = compileModules(modules, {});
writeFileSync(output, compiled['./app.tsx']!);

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function mockFetch(data: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
}

describe('DOM-Embedded JSON Payload Transport (RFC §16.6 & §16.7)', () => {
  it('delivers state envelope via <script type="application/mmd+json"> tag and auto-restores during hydrate()', async () => {
    const app = await importCompiled();
    const fetch = mockFetch({ name: 'Ada Lovelace' });

    // 1. Server resolves data and packages HTML + payload script tag
    const result = await renderToResultAsync(app.App, {
      mode: 'resolve',
      fetch,
      markers: true,
    });

    expect(result.html).toContain('Ada Lovelace');
    expect(result.scriptTag).toContain('<script type="application/mmd+json" data-mmd-root="App">');
    expect(result.payload.version).toBe(1);
    expect(result.payload.state).toBeDefined();

    // 2. Client host document contains both the rendered HTML and the embedded JSON channel
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML = result.html;
    document.body.appendChild(host);

    const scriptEl = document.createElement('div');
    scriptEl.innerHTML = result.scriptTag;
    document.body.appendChild(scriptEl.firstElementChild!);

    // Client data runtime has NO network fetch installed (will throw if it tries to issue a request)
    const clientDataRuntime = createDataRuntime({
      fetch: (() => {
        throw new Error('Client should not issue fetch — state must restore from payload channel');
      }) as typeof fetch,
    });
    setActiveDataRuntime(clientDataRuntime);

    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    // 3. Hydrate with default payload: 'auto'
    const mounted = hydrate('root', app.App);
    expect(host.querySelector('h1')?.textContent).toBe('Ada Lovelace');

    mounted.unmount();
    host.remove();
  });
});

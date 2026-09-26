import { afterEach, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToResultAsync } from '@memoized-dom/server';
import {
  mount,
  registerRootFactory,
  type MountedApplication,
} from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');
const output = join(outDir, 'ssr-query-fallback.compiled.ts');
const compiled = compileModules({
  './app.tsx': `
    import { $fetch, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
    function Loading() { return <p>Loading...</p>; }
    function Failed({ error, retry }) { return <p>{error.message}</p>; }
    export function App() {
      const user = $fetch('/api/user', { query: { id: 7 } });
      return <Group>
        <Pending component={Loading} />
        <ErrorArm component={Failed} />
        <h1>{user.name}</h1>
      </Group>;
    }
  `,
}, {});
mkdirSync(outDir, { recursive: true });
writeFileSync(output, compiled['./app.tsx']!);

let mounted: MountedApplication | undefined;
let host: Element | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

it('refetches an untransferred query source without leaving duplicate SSR DOM', async () => {
  const app = await import(pathToFileURL(output).href) as {
    App(id: string, parent: null): Node;
  };
  const response = () => new Response(JSON.stringify({ name: 'Ada' }), {
    headers: { 'content-type': 'application/json' },
  });
  const result = await renderToResultAsync(app.App, {
    mode: 'resolve',
    markers: true,
    fetch: (async () => response()) as typeof fetch,
  });
  expect(result.html).toContain('Ada');
  expect(result.payload.state).toBeUndefined();

  host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = result.html;
  document.body.appendChild(host);
  const payload = document.createElement('div');
  payload.innerHTML = result.scriptTag;
  document.body.appendChild(payload.firstElementChild!);

  const clientFetch = vi.fn(async () => response());
  vi.stubGlobal('fetch', clientFetch);
  registerRootFactory(app.App, {
    id: 'App',
    create: () => app.App('App', null),
  });
  mounted = mount('root', app.App);

  await vi.waitFor(() => expect(host?.querySelector('h1')?.textContent).toBe('Ada'));
  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(clientFetch).toHaveBeenCalledTimes(1);
});

/** End-to-end coverage for data resources through the opaque pull fallback. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const fixture = join(outDir, 'data-opaque-integration.compiled.ts');

const source = `
  import { createDataRuntime } from '@memoized-dom/data';

  const requests = [];
  export function requestCount() { return requests.length; }
  export function requestInput(index) { return requests[index]?.input; }
  export function requestSignal(index) { return requests[index]?.signal; }
  export function resetRequests() { requests.length = 0; }
  export function resolveRequest(index, data, status = 200) {
    requests[index].resolve(new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }));
  }

  function mockFetch(input, init) {
    return new Promise(resolve => {
      requests.push({ input, resolve, signal: init?.signal });
    });
  }

  export function App() {
    const data = createDataRuntime({ fetch: mockFetch });
    const users = data.$fetch('/users');
    cleanup(data.clear);

    return <main>
      <output id="status">{users.status}</output>
      {users.pending && <p id="loading">Loading</p>}
      {users.error && <p id="error">{users.error.kind}</p>}
      <ul>{users.data?.map(user =>
        <li key={user.id} data-id={user.id}>{user.name}</li>
      )}</ul>
    </main>;
  }

  export function SnapshotApp() {
    const data = createDataRuntime({ fetch: mockFetch });
    const users = data.$fetch('/users');
    const { data: snapshotData, status: snapshotStatus } = users;
    cleanup(data.clear);

    return <main>
      <output id="snapshot-status">{snapshotStatus}</output>
      <output id="snapshot-count">{snapshotData?.length ?? 0}</output>
      <output id="live-count">{users.data?.length ?? 0}</output>
    </main>;
  }

  export function NestedCollectionApp() {
    const data = createDataRuntime({ fetch: mockFetch });
    const feed = data.$fetch('/feed');
    cleanup(data.clear);

    return <ol id="nested-feed">{feed.data?.hits.map(hit =>
      <li key={hit.id}>{hit.title}</li>
    )}</ol>;
  }

  export function SearchApp() {
    const data = createDataRuntime({ fetch: mockFetch });
    let page = 1;
    function load() {
      return data.$fetch('/users', { query: { page } });
    }
    let users = load();
    cleanup(data.clear);

    return <main>
      <button id="next" onClick={() => {
        page++;
        const previous = users;
        users = load();
        previous.abort();
      }}>Next</button>
      <output id="search-status">{users.status}</output>
      <output id="search-result">{users.data?.[0]?.name ?? ''}</output>
    </main>;
  }
`;

function importFixture(): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(fixture).href);
}

describe('data resources through opaque volatility', () => {
  const frames: FrameRequestCallback[] = [];

  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      { './data-opaque-integration.tsx': source },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(fixture, output['./data-opaque-integration.tsx']!);
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler(run => run());
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    (await importFixture()).resetRequests();
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    while (frames.length > 0) frames.shift()!(performance.now());
    resetScheduler();
    vi.unstubAllGlobals();
  });

  async function pullFrame(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    const frame = frames.shift();
    expect(frame).toBeTypeOf('function');
    frame!(performance.now());
    await Promise.resolve();
  }

  it('renders loading, success, keyed lists, and HTTP errors without a data adapter', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.App('App', null));

    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    expect(document.querySelector('#status')?.textContent).toBe('pending');
    expect(document.querySelector('#loading')).not.toBeNull();
    expect(_internals().volatileSet.has('App')).toBe(true);

    mod.resolveRequest(0, [
      { id: 'a', name: 'Ada' },
      { id: 'g', name: 'Grace' },
    ]);
    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelector('#status')?.textContent).toBe('success');
    });

    expect(document.querySelector('#loading')).toBeNull();
    expect(
      [...document.querySelectorAll('li')].map(node => node.textContent),
    ).toEqual(['Ada', 'Grace']);

    unregister('App');
    document.body.replaceChildren();
    document.body.appendChild(mod.App('App', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(2));
    mod.resolveRequest(1, { message: 'failed' }, 503);
    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelector('#status')?.textContent).toBe('error');
    });
    expect(document.querySelector('#error')?.textContent).toBe('http');
  });

  it('keeps normal destructuring snapshot-based while direct getters stay live', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.SnapshotApp('SnapshotApp', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    mod.resolveRequest(0, [{ id: 'a', name: 'Ada' }]);

    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelector('#live-count')?.textContent).toBe('1');
    });

    expect(document.querySelector('#snapshot-status')?.textContent).toBe('pending');
    expect(document.querySelector('#snapshot-count')?.textContent).toBe('0');
  });

  it('maps an optional nested collection view directly from an opaque resource', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.NestedCollectionApp('NestedCollectionApp', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    mod.resolveRequest(0, {
      hits: [
        { id: 'one', title: 'Compiler-owned routes' },
        { id: 'two', title: 'Opaque data views' },
      ],
    });

    await vi.waitFor(async () => {
      await pullFrame();
      expect(
        [...document.querySelectorAll('#nested-feed li')].map(node => node.textContent),
      ).toEqual(['Compiler-owned routes', 'Opaque data views']);
    });
  });

  it('clears component-owned data work on removal and starts cleanly on remount', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.App('App', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    const firstSignal = mod.requestSignal(0) as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    unregister('App');

    expect(firstSignal.aborted).toBe(true);
    expect(_internals().volatileSet.has('App')).toBe(false);

    document.body.replaceChildren();
    document.body.appendChild(mod.App('App', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(2));
    expect(mod.requestSignal(1)).not.toBe(firstSignal);
    expect(document.querySelector('#loading')).not.toBeNull();
  });

  it('supports explicit argument changes by replacing ordinary component state', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.SearchApp('SearchApp', null));
    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    const firstSignal = mod.requestSignal(0) as AbortSignal;
    const firstURL = new URL(mod.requestInput(0));
    expect(`${firstURL.pathname}${firstURL.search}`).toBe('/users?page=1');

    document.querySelector<HTMLButtonElement>('#next')!.click();
    await vi.waitFor(() => expect(mod.requestCount()).toBe(2));

    expect(firstSignal.aborted).toBe(true);
    const secondURL = new URL(mod.requestInput(1));
    expect(`${secondURL.pathname}${secondURL.search}`).toBe('/users?page=2');
    expect(document.querySelector('#search-status')?.textContent).toBe('pending');

    mod.resolveRequest(1, [{ id: 'g', name: 'Grace' }]);
    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelector('#search-result')?.textContent).toBe('Grace');
    });
  });
});

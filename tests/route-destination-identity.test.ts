import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { createRouteRuntime, setActiveRouteRuntime, type RouteRuntime } from '@memoized-dom/router';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const sources = {
  './Detail.tsx': `
    import { route } from '@memoized-dom/router';
    import { $fetch } from '@memoized-dom/data';
    export function Detail() {
      const data = $fetch('/destination/' + route.params.id);
      let clicks = 0;
      return <article id="detail"><button id="count" onClick={() => { clicks++; }}>{clicks}</button><span>{data.name}</span></article>;
    }
  `,
  './App.tsx': `
    import { Detail } from './Detail';
    import { Group } from '@memoized-dom/data';
    function Loading() { return <i class="loading">Loading</i>; }
    export function App() {
      let visits = 0;
      return <main route="/" id="layout"><button id="visits" onClick={() => { visits++; }}>{visits}</button>
        <Group pending={Loading}><Detail route="/reports/:id" suspend /></Group>
      </main>;
    }
  `,
};
describe('compiled route destination identity and readiness', () => {
  let App: (id: string, parent: null) => Node;
  let router: RouteRuntime;
  let previousRouter: RouteRuntime;
  let data: DataRuntime;
  let previousData: DataRuntime;
  let requests: Array<{ url: string; signal?: AbortSignal | null; resolve(response: Response): void }>;
  beforeAll(async () => {
    const output = compileModules(sources);
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'route-destination');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(output)) writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    ({ App } = await import(pathToFileURL(join(directory, 'App.ts')).href));
  });
  beforeEach(() => {
    router = createRouteRuntime({ environment: { location: { href: 'http://localhost/' } as Location } });
    previousRouter = setActiveRouteRuntime(router);
    requests = [];
    data = createDataRuntime({ fetch: ((input: unknown, init?: RequestInit) =>
      new Promise<Response>(resolve => requests.push({ url: String(input), signal: init?.signal, resolve }))) as typeof fetch });
    previousData = setActiveDataRuntime(data);
    setScheduler(run => run());
    document.body.append(App('App', null));
  });
  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    router.dispose();
    setActiveRouteRuntime(previousRouter);
    data.clear();
    setActiveDataRuntime(previousData);
    resetScheduler();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  function resolve(index: number, name: string) {
    requests[index]!.resolve(new Response(JSON.stringify({ name }), { headers: { 'content-type': 'application/json' } }));
  }
  it('re-suspends changed parameters, retains parent state, and preserves query/hash instance state', async () => {
    const layout = document.querySelector('#layout');
    document.querySelector<HTMLButtonElement>('#visits')!.click();
    router.navigate('/reports/one');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(document.querySelector('#detail')).toBeNull();
    expect(document.querySelector('.loading')).not.toBeNull();
    resolve(0, 'One');
    await vi.waitFor(() => expect(document.querySelector('#detail span')?.textContent).toBe('One'));
    const original = document.querySelector('#detail');
    document.querySelector<HTMLButtonElement>('#count')!.click();
    router.navigate('/reports/one', { query: { tab: 'notes' } });
    router.navigate('/reports/one', { query: { tab: 'notes' }, hash: 'target' });
    expect(document.querySelector('#detail')).toBe(original);
    expect(document.querySelector('#count')?.textContent).toBe('1');
    router.navigate('/reports/two');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelector('#detail')).toBeNull();
    expect(document.querySelector('.loading')).not.toBeNull();
    expect(document.querySelector('#layout')).toBe(layout);
    expect(document.querySelector('#visits')?.textContent).toBe('1');
    resolve(1, 'Two');
    await vi.waitFor(() => expect(document.querySelector('#detail span')?.textContent).toBe('Two'));
    expect(document.querySelector('#detail')).not.toBe(original);
    expect(document.querySelector('#count')?.textContent).toBe('0');
  });
  it('does not scroll to the new page until its atomic output has committed', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    router.navigate('/reports/one');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(scroll).not.toHaveBeenCalled();
    resolve(0, 'One');
    await vi.waitFor(() => expect(document.querySelector('#detail')).not.toBeNull());
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledWith(0, 0));
  });
  it('abandons a parameter destination without stale publication or scroll', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    router.navigate('/reports/one');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    router.navigate('/reports/two');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.signal?.aborted).toBe(true);
    resolve(0, 'Obsolete');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector('#detail')).toBeNull();
    resolve(1, 'Current');
    await vi.waitFor(() => expect(document.querySelector('#detail span')?.textContent).toBe('Current'));
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  });
});

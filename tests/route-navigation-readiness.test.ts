import { waitFor, stubGlobal, unstubAllGlobals, type FetchStub } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import {
  createRouteRuntime, createMemoryRouteHistory, setActiveRouteRuntime,
  type RouteRuntime, type RouteNavigationEvent, type RouteNavigationResult,
} from '@memoized-dom/router';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const sources = {
  './Detail.tsx': `
    import { route, $routed } from '@memoized-dom/router';
    import { $fetch } from '@memoized-dom/data';
    export function Detail() {
      const data = $fetch('/ready/' + route.params.id);
      return <article id="detail">{data.name}</article>;
    }
    export function Guarded() {
      const entry = $routed(({ params }) => globalThis.__mmdEntry(params.id));
      const data = $fetch('/private/' + route.params.id);
      return <article id="guarded">{entry}:{data.name}</article>;
    }
  `,
  './App.tsx': `
    import { Detail, Guarded } from './Detail';
    import { Group } from '@memoized-dom/data';
    function Loading() { return <i class="loading">Loading</i>; }
    function Failed({ error, retry }) { return <button class="failed" onClick={retry}>{error.kind}</button>; }
    export function App() {
      return <main route="/" id="layout"><h1>Layout</h1>
        <Group pending={Loading} error={Failed}>
          <Detail route="/plain/:id" suspend />
          <Guarded route="/guarded/:id" suspend />
        </Group>
      </main>;
    }
  `,
};

describe('navigation completion follows destination DOM readiness', () => {
  let App: (id: string, parent: null) => Node;
  let router: RouteRuntime;
  let previousRouter: RouteRuntime;
  let data: DataRuntime;
  let previousData: DataRuntime;
  let events: RouteNavigationEvent[];
  let requests: Array<{ resolve(response: Response): void }>;
  beforeAll(async () => {
    const output = compileModules(sources);
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'route-navigation-readiness');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(output)) writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    ({ App } = await import(pathToFileURL(join(directory, 'App.ts')).href));
  });
  beforeEach(() => {
    router = createRouteRuntime({ routeHistory: createMemoryRouteHistory() });
    previousRouter = setActiveRouteRuntime(router);
    events = [];
    router.subscribeNavigation(event => events.push(event));
    requests = [];
    data = createDataRuntime({ fetch: (() => new Promise<Response>(resolve => requests.push({ resolve }))) as FetchStub });
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
    unstubAllGlobals();
  });
  function resolve(index: number, name: string, status = 200) {
    requests[index]!.resolve(new Response(JSON.stringify({ name }), { status, headers: { 'content-type': 'application/json' } }));
  }
  function finished(result: RouteNavigationResult) {
    expect(result.status).toBe('preparing');
    if (result.status !== 'preparing') throw new Error('Expected deferred destination activation');
    return result.finished;
  }
  it('publishes the URL but does not complete when only an atomic pending arm is visible', async () => {
    const result = router.navigate('/plain/one');
    const completion = finished(result);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(router.route.pathname).toBe('/plain/one');
    expect(document.querySelector('.loading')).not.toBeNull();
    expect(events.map(event => event.phase)).toEqual(['start', 'prepare']);
    resolve(0, 'One');
    expect(await completion).toMatchObject({ status: 'completed' });
    expect(document.querySelector('#detail')?.textContent).toBe('One');
    expect(events.map(event => event.phase)).toEqual(['start', 'prepare', 'complete']);
  });
  it('awaits destination discovery through the default scheduler', async () => {
    resetScheduler();
    const completion = finished(router.navigate('/plain/one'));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(events.some(event => event.phase === 'complete')).toBe(false);
    resolve(0, 'Scheduled');
    await completion;
    expect(document.querySelector('#detail')?.textContent).toBe('Scheduled');
    expect(events.at(-1)?.phase).toBe('complete');
  });
  it('rejects an abandoned completion and never emits its stale success', async () => {
    const first = router.navigate('/plain/one');
    const firstFinished = finished(first);
    await waitFor(() => expect(requests).toHaveLength(1));
    const second = router.navigate('/plain/two');
    const secondFinished = finished(second);
    await expect(firstFinished).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(requests).toHaveLength(2));
    resolve(0, 'Stale');
    resolve(1, 'Current');
    await secondFinished;
    expect(events.filter(event => event.phase === 'complete').map(event => event.navigation.id)).toEqual([second.navigation.id]);
    expect(events.filter(event => event.phase === 'error')).toHaveLength(0);
  });
  it('keeps waiting for the same atomic instance through query and hash changes', async () => {
    const initial = finished(router.navigate('/plain/one'));
    await waitFor(() => expect(requests).toHaveLength(1));
    const query = finished(router.navigate('/plain/one', { query: { tab: 'notes' } }));
    await expect(initial).rejects.toMatchObject({ name: 'AbortError' });
    const hash = finished(router.navigate('/plain/one', { query: { tab: 'notes' }, hash: 'target' }));
    await expect(query).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
    expect(events.some(event => event.phase === 'complete')).toBe(false);
    resolve(0, 'Same instance');
    await hash;
    expect(document.querySelector('#detail')?.textContent).toBe('Same instance');
    expect(events.filter(event => event.phase === 'complete')).toHaveLength(1);
    expect(router.route.hash).toBe('#target');
  });
  it('reports an atomic request failure without replaying successful entry or creating history on local retry', async () => {
    const completion = finished(router.navigate('/plain/one'));
    await waitFor(() => expect(requests).toHaveLength(1));
    resolve(0, 'Unavailable', 503);
    await expect(completion).rejects.toMatchObject({ status: 503 });
    expect(events.at(-1)?.phase).toBe('error');
    expect(events.at(-1)?.retry).toBeUndefined();
    expect(document.querySelector('.failed')?.textContent).toBe('request');
    document.querySelector<HTMLButtonElement>('.failed')!.click();
    await waitFor(() => expect(requests).toHaveLength(2));
    resolve(1, 'Recovered');
    await waitFor(() => expect(document.querySelector('#detail')?.textContent).toBe('Recovered'));
    expect(events.filter(event => event.phase === 'start')).toHaveLength(1);
    expect(router.back()?.status).toBe('completed');
    expect(router.route.pathname).toBe('/');
    expect(router.back()).toBeNull();
  });
  it('finishes memory history traversal only after the selected atomic destination mounts', async () => {
    const initial = finished(router.navigate('/plain/one'));
    await waitFor(() => expect(requests).toHaveLength(1));
    resolve(0, 'First');
    await initial;
    router.navigate('/');
    const traversal = finished(router.back()!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(events.at(-1)?.phase).toBe('prepare');
    resolve(1, 'Returned');
    await traversal;
    expect(document.querySelector('#detail')?.textContent).toBe('Returned');
    expect(events.at(-1)?.navigation.type).toBe('pop');
    expect(events.at(-1)?.phase).toBe('complete');
  });
  it('keeps $routed as a pre-entry gate and then waits separately for owned atomic reads', async () => {
    let allow!: (value: string) => void;
    stubGlobal('__mmdEntry', vi.fn(() => new Promise<string>(resolve => { allow = resolve; })));
    const completion = finished(router.navigate('/guarded/private'));
    await waitFor(() => expect(allow).toBeTypeOf('function'));
    expect(requests).toHaveLength(0);
    expect(document.querySelector('#guarded')).toBeNull();
    expect(router.route.pathname).toBe('/');
    allow('Authorized');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(router.route.pathname).toBe('/guarded/private');
    expect(document.querySelector('#guarded')).toBeNull();
    expect(events.some(event => event.phase === 'complete')).toBe(false);
    resolve(0, 'Private data');
    await completion;
    expect(document.querySelector('#guarded')?.textContent).toBe('Authorized:Private data');
    expect(events.filter(event => event.phase === 'complete')).toHaveLength(1);
  });
  it('rejects pending completion immediately when its router is disposed', async () => {
    const completion = finished(router.navigate('/plain/one'));
    await waitFor(() => expect(requests).toHaveLength(1));
    router.dispose();
    await expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.some(event => event.phase === 'complete')).toBe(false);
  });
});

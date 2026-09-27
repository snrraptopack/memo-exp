import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { renderToResultAsync, renderToString, renderToStringAsync } from '@memoized-dom/server';
import { mount, registerRootFactory, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const modules = {
  './Tsrx.tsrx': `
    import { Leaf } from './Leaf';
    export function Tsrx() @{
      const label = 'TSRX';
      @try {
        <Leaf suspend />
      } @pending {
        <i class="tsrx-loading">Waiting {label}</i>
      } @catch (error, retry) {
        <button class="tsrx-failed" onClick={retry}>{error.kind}:{error.status}</button>
      }
    }
  `,
  './Leaf.tsx': `
    import { $fetch, Group } from '@memoized-dom/data';
    function Inner() { return <i class="inner">Inner</i>; }
    export function Leaf() {
      const data = $fetch('/atomic/leaf');
      return <Group pending={Inner}><article suspend id="leaf">{data.name}</article></Group>;
    }
  `,
  './App.tsx': `
    import { Group } from '@memoized-dom/data';
    import { Leaf } from './Leaf';
    function Loading() { return <i class="loading">Loading</i>; }
    function Failed({ retry }) { return <button class="failed" onClick={retry}>Retry</button>; }
    export function App() {
      let visible = true;
      return <main><h1>Unchanged</h1>
        <button id="hide" onClick={() => { visible = false; }}>Hide</button>
        <Group pending={Loading} error={Failed}>
          {visible ? <Group suspend><header id="held">Held</header><Leaf /><footer>End</footer></Group> : <p>Hidden</p>}
        </Group>
      </main>;
    }
    export function Static() { return <Group suspend><h2>Ready</h2><p>Once</p></Group>; }
  `,
};
type Factory = (id: string, parent: null) => Node;
describe('authored descendant-wide suspension', () => {
  let fixture: Record<string, Factory>;
  let data: DataRuntime | undefined;
  let previous: DataRuntime | undefined;
  let mounted: MountedApplication | undefined;
  let requests: Array<{ signal: AbortSignal | null | undefined; resolve(response: Response): void }> = [];
  beforeAll(async () => {
    const output = compileModules(modules);
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'authored-suspend');
    mkdirSync(directory, { recursive: true });
    for (const [name, source] of Object.entries(output)) {
      writeFileSync(join(directory, name.replace(/\.(tsx|tsrx)$/, '.ts')), source);
    }
    fixture = await import(pathToFileURL(join(directory, 'App.ts')).href);
    Object.assign(fixture = { ...fixture }, await import(pathToFileURL(join(directory, 'Tsrx.ts')).href));
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    for (const id of _internals().registry.keys()) unregister(id);
    if (previous !== undefined) setActiveDataRuntime(previous);
    data?.clear();
    data = undefined;
    previous = undefined;
    resetScheduler();
    document.body.replaceChildren();
    requests = [];
  });
  function setup() {
    data = createDataRuntime({ fetch: ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>(resolve => requests.push({ signal: init?.signal, resolve }))) as typeof fetch });
    previous = setActiveDataRuntime(data);
    setScheduler(run => run());
  }
  function response(name: string, status = 200) {
    return new Response(JSON.stringify({ name }), { status, headers: { 'content-type': 'application/json' } });
  }
  it('claims descendant-owned reads and nested suspension under one inherited policy', async () => {
    setup();
    document.body.append(fixture.App!('App', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(document.querySelector('h1')?.textContent).toBe('Unchanged');
    expect(document.querySelectorAll('.loading')).toHaveLength(1);
    expect(document.querySelector('.inner')).toBeNull();
    expect(document.querySelector('#held')).toBeNull();
    requests[0]!.resolve(response('Ready'));
    await vi.waitFor(() => expect(document.querySelector('#leaf')?.textContent).toBe('Ready'));
    expect(document.querySelector('#held')?.textContent).toBe('Held');
    expect(document.querySelector('.loading')).toBeNull();
  });
  it('aborts abandoned child work and cannot publish a stale generation', async () => {
    setup();
    document.body.append(fixture.App!('App', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    document.querySelector<HTMLButtonElement>('#hide')!.click();
    expect(requests[0]!.signal?.aborted).toBe(true);
    requests[0]!.resolve(response('Too late'));
    await Promise.resolve();
    expect(document.body.textContent).toContain('Hidden');
    expect(document.querySelector('#leaf')).toBeNull();
    expect(document.querySelector('.loading')).toBeNull();
  });
  it('renders static Groups immediately without pending data', () => {
    setup();
    document.body.append(fixture.Static!('Static', null));
    expect(document.body.textContent).toBe('ReadyOnce');
    expect(requests).toHaveLength(0);
  });
  it('discovers descendant-owned TSRX reads without requiring source props and retries failures', async () => {
    setup();
    document.body.append(fixture.Tsrx!('Tsrx', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(document.querySelector('.tsrx-loading')?.textContent).toBe('Waiting TSRX');
    expect(document.querySelector('.inner')).toBeNull();
    expect(document.querySelector('#leaf')).toBeNull();
    requests[0]!.resolve(response('Unavailable', 503));
    await vi.waitFor(() => expect(document.querySelector('.tsrx-failed')?.textContent).toBe('request:503'));
    document.querySelector<HTMLButtonElement>('.tsrx-failed')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!.resolve(response('Recovered TSRX'));
    await vi.waitFor(() => expect(document.querySelector('#leaf')?.textContent).toBe('Recovered TSRX'));
    expect(document.querySelector('.tsrx-loading')).toBeNull();
  });
  it('resolves the same descendant TSRX preparation during SSR', async () => {
    const html = await renderToStringAsync(fixture.Tsrx!, {
      mode: 'resolve', fetch: (async () => response('TSRX server')) as typeof fetch,
    });
    expect(html).toContain('TSRX server');
    expect(html).not.toContain('tsrx-loading');
  });
  it('rolls back a failed descendant and recreates its owned request on retry', async () => {
    setup();
    document.body.append(fixture.App!('App', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!.resolve(response('Failed', 503));
    await vi.waitFor(() => expect(document.querySelector('.failed')).not.toBeNull());
    expect(document.querySelector('#held')).toBeNull();
    expect(document.querySelector('#leaf')).toBeNull();
    document.querySelector<HTMLButtonElement>('.failed')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelector('.loading')).not.toBeNull();
    requests[1]!.resolve(response('Recovered'));
    await vi.waitFor(() => expect(document.querySelector('#leaf')?.textContent).toBe('Recovered'));
    expect(document.querySelector('#held')).not.toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Unchanged');
  });
  it('renders only the outer shell in synchronous SSR', () => {
    const html = renderToString(fixture.App!, { mode: 'shell', fetch: (() => new Promise(() => {})) as typeof fetch });
    expect(html).toContain('class="loading"');
    expect(html).not.toContain('id="held"');
    expect(html).not.toContain('class="inner"');
  });
  it('settles authored descendant preparation during resolved SSR', async () => {
    const html = await renderToStringAsync(fixture.App!, {
      mode: 'resolve', fetch: (async () => response('Server ready')) as typeof fetch, markers: true,
    });
    expect(html).toContain('Server ready');
    expect(html).toContain('id="held"');
    expect(html).not.toContain('class="loading"');
  });
  it('adopts compiled static atomic ranges in place with no hydration errors', async () => {
    const html = renderToString(fixture.Static!, { markers: true });
    setup();
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const original = host.querySelector('h2');
    const onHydrateError = vi.fn();
    registerRootFactory(fixture.Static!, { id: 'App', create: () => fixture.Static!('App', null) });
    mounted = mount(host, fixture.Static! as () => unknown, { onHydrateError });
    await Promise.resolve();
    expect(onHydrateError).not.toHaveBeenCalled();
    expect(host.querySelector('h2')).toBe(original);
    expect(host.querySelectorAll('h2')).toHaveLength(1);
  });
  it('adopts resolved descendant data without refetching or replacing server DOM', async () => {
    const result = await renderToResultAsync(fixture.App!, {
      mode: 'resolve', markers: true, fetch: (async () => response('Transferred')) as typeof fetch,
    });
    setup();
    const host = document.createElement('div');
    host.innerHTML = result.html;
    const payload = document.createElement('div');
    payload.innerHTML = result.scriptTag;
    document.body.append(host, payload);
    const original = host.querySelector('#leaf');
    const onHydrateError = vi.fn();
    registerRootFactory(fixture.App!, { id: 'App', create: () => fixture.App!('App', null) });
    mounted = mount(host, fixture.App! as () => unknown, { onHydrateError });
    await Promise.resolve();
    expect(onHydrateError).not.toHaveBeenCalled();
    expect(host.querySelector('#leaf')).toBe(original);
    expect(original?.textContent).toBe('Transferred');
    expect(requests).toHaveLength(0);
    expect(host.querySelector('.loading')).toBeNull();
  });
});

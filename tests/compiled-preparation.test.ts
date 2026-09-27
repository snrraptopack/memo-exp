import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import {
  createApplicationRuntime, createPreparedRegion, createRenderPreparation,
  getEntity, rootNodes, runWithApplicationRuntime, setScheduler,
  type ApplicationRuntime,
} from '@memoized-dom/runtime/testing';

const modules = {
  './Leaf.tsx': `
    import { $fetch } from '@memoized-dom/data';
    let input: HTMLInputElement | null = null;
    export function currentInput() { return input; }
    export function Leaf() {
      const user = $fetch<{ name: string }>('/leaf');
      const unused = $fetch('/unused');
      effect(() => globalThis.__prepareEffect(input));
      return <section id="leaf"><input ref={input} value={user.name} /><span>{user.name}</span></section>;
    }
  `,
  './App.tsx': `
    import { $fetch, Group } from '@memoized-dom/data';
    import { Leaf } from './Leaf';
    export function App() {
      const show = $fetch<{ enabled: boolean }>('/show');
      return <Group><h1 id="static">Static shell</h1>{show.enabled && <Leaf />}</Group>;
    }
    export function AttributeOnly() {
      const user = $fetch<{ name: string }>('/attribute');
      return <input id="attribute" value={user.name} />;
    }
    function Target({ name }) { return <output id="prop">{name}</output>; }
    export function PropRead() {
      const user = $fetch<{ name: string }>('/prop');
      return <Target name={user.name} />;
    }
    export function SpreadHost() {
      const user = $fetch<{ name: string }>('/spread-host');
      return <input id="spread-host" {...{ value: user.name }} title="ready" />;
    }
    export function SpreadProp() {
      const user = $fetch<{ name: string }>('/spread-prop');
      return <Target {...{ name: user.name }} />;
    }
    let visible = true;
    export function ConditionalAttribute() {
      const user = $fetch<{ name: string }>('/conditional');
      return <Group><main><button id="hide" onClick={() => { visible = false; }}>Hide</button>
        {visible ? <input id="conditional" value={user.name} /> : <i>Gone</i>}</main></Group>;
    }
  `,
  './List.tsx': `
    import { $fetch } from '@memoized-dom/data';
    const items = $fetch<{ id: string }[]>('/module-list');
    const profile = $fetch<{ name: string }>('/module-spread');
    export function ModuleSpread() {
      return <input id="module-spread" {...{ value: profile.name }} />;
    }
    function ListLeaf() {
      const user = $fetch<{ name: string }>('/list-leaf');
      effect(() => globalThis.__prepareEffect(null));
      return <section id="list-leaf"><input value={user.name} /></section>;
    }
    export function ModuleList() {
      return <main id="module-list">{items.map(item => <ListLeaf key={item.id} />)}</main>;
    }
  `,
};
type Factory = (id: string, parent: string | null) => Node;

describe('compiler-owned detached preparation', () => {
  let fixture: Record<string, Factory>;
  let leaf: { currentInput(): HTMLInputElement | null | undefined };
  let list: Record<string, Factory>;
  let application: ApplicationRuntime;
  let data: DataRuntime;
  let previous: DataRuntime;
  let requests: Array<{ url: string; resolve(response: Response): void }>;
  let effects: ReturnType<typeof vi.fn>;
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(application, run);
  beforeAll(async () => {
    const output = compileModules(modules);
    const directory = join(import.meta.dirname, 'fixtures/out/compiled-preparation');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(output)) {
      writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    }
    fixture = await import(pathToFileURL(join(directory, 'App.ts')).href);
    leaf = await import(pathToFileURL(join(directory, 'Leaf.ts')).href);
    list = await import(pathToFileURL(join(directory, 'List.ts')).href);
  });
  beforeEach(() => {
    requests = [];
    effects = vi.fn();
    vi.stubGlobal('__prepareEffect', effects);
    application = createApplicationRuntime('compiled-preparation', { document, schedule: null });
    data = createDataRuntime({ fetch: ((input: RequestInfo | URL) =>
      new Promise<Response>(resolve => requests.push({ url: String(input), resolve }))) as typeof fetch });
    previous = setActiveDataRuntime(data);
    inRuntime(() => setScheduler(run => queueMicrotask(() => inRuntime(run))));
  });
  afterEach(() => {
    application.dispose();
    data.clear();
    setActiveDataRuntime(previous);
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  async function respond(url: string, body: unknown) {
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith(url))).toBe(true));
    requests.find(request => request.url.endsWith(url))!.resolve(new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    }));
  }
  function create(name: string) {
    const root = fixture[name]!(name, null);
    return { nodes: rootNodes(root), update() {} };
  }

  it('discovers cross-file child resources after a conditional settles without remounting', async () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const root = preparation.run(() => fixture.App!('App', null));
    expect(preparation.readiness).toBe('pending');
    expect(effects).not.toHaveBeenCalled();
    await respond('/show', { enabled: true });
    await vi.waitFor(() => expect(root.textContent).toContain('Static shell'));
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith('/leaf'))).toBe(true));
    const entity = [...application.state.registry.values()].find(entity => entity.id.endsWith('/Leaf'));
    expect(entity).toBeDefined();
    const input = (root as Element).querySelector('input');
    expect(preparation.readiness).toBe('pending');
    expect(inRuntime(() => leaf.currentInput())).toBeNull();
    await respond('/leaf', { name: 'Ada' });
    await vi.waitFor(() => expect(preparation.readiness).toBe('ready'));
    expect(inRuntime(() => getEntity(entity!.id))).toBe(entity);
    expect((root as Element).querySelector('input')).toBe(input);
    expect(requests.filter(request => request.url.endsWith('/leaf'))).toHaveLength(1);
    document.body.append(root);
    preparation.activate();
    expect(inRuntime(() => leaf.currentInput())).toBe(input);
    await vi.waitFor(() => expect(effects).toHaveBeenCalledExactlyOnceWith(input));
  });

  it.each(['AttributeOnly', 'PropRead'])('tracks initial and incremental payload reads in %s', async name => {
    const preparation = inRuntime(() => createRenderPreparation());
    const root = preparation.run(() => fixture[name]!(name, null));
    expect(preparation.readiness).toBe('pending');
    await respond(name === 'AttributeOnly' ? '/attribute' : '/prop', { name: 'Grace' });
    await vi.waitFor(() => expect(preparation.readiness).toBe('ready'));
    expect(name === 'AttributeOnly' ? (root as HTMLInputElement).value : root.textContent).toBe('Grace');
  });

  it('releases a non-entity branch read when that branch disappears', async () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const root = preparation.run(() => fixture.ConditionalAttribute!('App', null));
    expect(preparation.readiness).toBe('pending');
    inRuntime(() => (root as Element).querySelector<HTMLButtonElement>('#hide')!.click());
    await vi.waitFor(() => expect(root.textContent).toContain('Gone'));
    expect(preparation.readiness).toBe('ready');
  });

  it.each(['SpreadHost', 'SpreadProp'])('tracks source reads and updates through %s', async name => {
    const preparation = inRuntime(() => createRenderPreparation());
    const root = preparation.run(() => fixture[name]!(name, null));
    expect(preparation.readiness).toBe('pending');
    await respond(name === 'SpreadHost' ? '/spread-host' : '/spread-prop', { name: 'Katherine' });
    await vi.waitFor(() => expect(preparation.readiness).toBe('ready'));
    expect(name === 'SpreadHost' ? (root as HTMLInputElement).value : root.textContent).toBe('Katherine');
  });

  it.each(['SpreadHost', 'SpreadProp'])('updates mounted %s without a preparation observer', async name => {
    const root = inRuntime(() => fixture[name]!(name, null));
    document.body.append(root);
    await respond(name === 'SpreadHost' ? '/spread-host' : '/spread-prop', { name: 'Dorothy' });
    await vi.waitFor(() => expect(
      name === 'SpreadHost' ? (root as HTMLInputElement).value : root.textContent,
    ).toBe('Dorothy'));
  });

  it('collects lazy module-source reads in spread attributes', async () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const root = preparation.run(() => list.ModuleSpread!('ModuleSpread', null));
    expect(preparation.readiness).toBe('pending');
    await respond('/module-spread', { name: 'Mary' });
    await vi.waitFor(() => expect(preparation.readiness).toBe('ready'));
    expect((root as HTMLInputElement).value).toBe('Mary');
  });

  it('waits for module list reads and descendants discovered when the list settles', async () => {
    const region = inRuntime(() => createPreparedRegion(document.body, 'list-boundary', () => {
      const root = list.ModuleList!('ModuleList', null);
      return { nodes: rootNodes(root), update() {} };
    }, () => ({ nodes: [document.createTextNode('Loading list')], update() {} })));
    expect(region.status).toBe('pending');
    await respond('/module-list', [{ id: 'one' }]);
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith('/list-leaf'))).toBe(true));
    expect(region.status).toBe('pending');
    expect(document.body.textContent).toBe('Loading list');
    expect(effects).not.toHaveBeenCalled();
    await respond('/list-leaf', { name: 'Ada' });
    await vi.waitFor(() => expect(region.status).toBe('active'));
    expect(document.querySelectorAll('#list-leaf')).toHaveLength(1);
    expect(document.querySelector('input')?.value).toBe('Ada');
    expect(effects).toHaveBeenCalledTimes(1);
    region.dispose();
    expect(application.state.registry.size).toBe(0);
  });

  it('publishes the final range once, including late child output, before activating refs/effects', async () => {
    const fallbackDisposed = vi.fn();
    const pending = document.createElement('p');
    pending.textContent = 'Loading';
    const region = inRuntime(() => createPreparedRegion(document.body, 'app-boundary', () => create('App'),
      () => ({ nodes: [pending], update() {}, dispose: fallbackDisposed })));
    expect(document.body.textContent).toBe('Loading');
    await respond('/show', { enabled: true });
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith('/leaf'))).toBe(true));
    expect(document.querySelector('#static')).toBeNull();
    expect(document.querySelector('#leaf')).toBeNull();
    expect(effects).not.toHaveBeenCalled();
    await respond('/leaf', { name: 'Ada' });
    await vi.waitFor(() => expect(region.status).toBe('active'));
    expect(document.querySelectorAll('#static')).toHaveLength(1);
    expect(document.querySelectorAll('#leaf')).toHaveLength(1);
    const input = document.querySelector('input');
    expect(input?.value).toBe('Ada');
    expect(effects).toHaveBeenCalledExactlyOnceWith(input);
    expect(fallbackDisposed).toHaveBeenCalledTimes(1);
    region.dispose();
    expect(document.body.textContent).toBe('');
    expect(inRuntime(() => leaf.currentInput())).toBeUndefined();
  });

  it('abandons a staged range without publishing stale completions or lifecycles', async () => {
    const region = inRuntime(() => createPreparedRegion(document.body, 'app-boundary', () => create('App')));
    await respond('/show', { enabled: true });
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith('/leaf'))).toBe(true));
    region.dispose();
    await respond('/leaf', { name: 'Too late' });
    await Promise.resolve();
    expect(region.status).toBe('disposed');
    expect(document.body.textContent).toBe('');
    expect(effects).not.toHaveBeenCalled();
    expect(application.state.registry.size).toBe(0);
  });

  it('lets an outer pending region own nested discovery without exposing an inner fallback', async () => {
    const innerPending = vi.fn();
    const container = document.createElement('div');
    const outer = inRuntime(() => createPreparedRegion(document.body, 'outer-boundary', () => {
      const inner = createPreparedRegion(container, 'inner-boundary', () => create('AttributeOnly'), innerPending);
      return { nodes: [container], update() {}, dispose: () => inner.dispose() };
    }, () => ({ nodes: [document.createTextNode('Outer loading')], update() {} })));
    expect(document.body.textContent).toBe('Outer loading');
    expect(innerPending).not.toHaveBeenCalled();
    await respond('/attribute', { name: 'Grace' });
    await vi.waitFor(() => expect(outer.status).toBe('active'));
    expect(document.querySelector<HTMLInputElement>('#attribute')?.value).toBe('Grace');
    outer.dispose();
    expect(application.state.registry.size).toBe(0);
    expect(document.body.textContent).toBe('');
  });
});

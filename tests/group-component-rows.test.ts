import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const modules = {
  './Row.tsx': `
    import { $fetch } from '@memoized-dom/data';
    export function Row({ item }) {
      const detail = $fetch('/row/' + item.id);
      return <li data-row={item.id}><h2>{item.title}</h2><span>{detail.name}</span></li>;
    }
  `,
  './App.tsx': `
    import { Row } from './Row';
    import { Group } from '@memoized-dom/data';
    function Loading() { return <i class="waiting">Waiting</i>; }
    function Failed({ retry }) { return <button class="failed" onClick={retry}>Retry</button>; }
    export function Progressive() {
      const items = [{ id: 'one', title: 'First' }, { id: 'two', title: 'Second' }];
      return <Group pending={Loading} error={Failed}><ul>{items.map(item => <Row key={item.id} item={item} />)}</ul></Group>;
    }
    export function Atomic() {
      const items = [{ id: 'one', title: 'First' }, { id: 'two', title: 'Second' }];
      let visible = true;
      return <main><button id="hide" onClick={() => { visible = false; }}>Hide</button>
        <Group pending={Loading} error={Failed}>
          {visible ? <ul suspend>{items.map(item => <Row key={item.id} item={item} />)}</ul> : <p>Hidden</p>}
        </Group>
      </main>;
    }
  `,
};

describe('Group policies through specialized component rows', () => {
  let fixture: Record<string, (id: string, parent: null) => Node>;
  let data: DataRuntime | undefined;
  let previous: DataRuntime | undefined;
  let requests: Array<{ url: string; signal?: AbortSignal | null; resolve(response: Response): void }>;
  beforeAll(async () => {
    const output = compileModules(modules);
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'group-component-rows');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(output)) writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    fixture = await import(pathToFileURL(join(directory, 'App.ts')).href);
  });
  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    if (previous !== undefined) setActiveDataRuntime(previous);
    data?.clear();
    data = undefined;
    previous = undefined;
    resetScheduler();
    document.body.replaceChildren();
  });
  function mount(name: string) {
    requests = [];
    data = createDataRuntime({ fetch: ((url: unknown, init?: RequestInit) =>
      new Promise<Response>(resolve => requests.push({ url: String(url), signal: init?.signal, resolve }))) as typeof fetch });
    previous = setActiveDataRuntime(data);
    setScheduler(run => run());
    document.body.append(fixture[name]!(name, null));
  }
  function resolve(index: number, name: string, status = 200) {
    requests[index]!.resolve(new Response(JSON.stringify({ name }), { status, headers: { 'content-type': 'application/json' } }));
  }
  it('inherits read-local pending and error policies across files without suspending static rows', async () => {
    mount('Progressive');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelectorAll('.waiting')).toHaveLength(2);
    expect(document.querySelector('h2')?.textContent).toBe('First');
    resolve(0, 'Ready one');
    resolve(1, 'Failed', 503);
    await vi.waitFor(() => expect(document.querySelector('.failed')).not.toBeNull());
    expect(document.querySelector('[data-row="one"] span')?.textContent).toBe('Ready one');
    document.querySelector<HTMLButtonElement>('.failed')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toContain('/row/two');
    resolve(2, 'Recovered two');
    await vi.waitFor(() => expect(document.querySelector('[data-row="two"] span')?.textContent).toBe('Recovered two'));
    expect(document.querySelectorAll('li')).toHaveLength(2);
  });
  it('discovers all component-row reads before publishing one atomic list', async () => {
    mount('Atomic');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelectorAll('.waiting')).toHaveLength(1);
    expect(document.querySelector('ul')).toBeNull();
    resolve(0, 'First ready');
    await Promise.resolve();
    expect(document.querySelector('ul')).toBeNull();
    resolve(1, 'Second ready');
    await vi.waitFor(() => expect(document.querySelectorAll('li')).toHaveLength(2));
    expect(document.querySelector('ul')?.textContent).toContain('First ready');
    expect(document.querySelector('ul')?.textContent).toContain('Second ready');
    expect(document.querySelector('.waiting')).toBeNull();
  });
  it('abandons every staged row request when its atomic list is removed', async () => {
    mount('Atomic');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    document.querySelector<HTMLButtonElement>('#hide')!.click();
    expect(requests.every(request => request.signal?.aborted)).toBe(true);
    resolve(0, 'Late one');
    resolve(1, 'Late two');
    await Promise.resolve();
    expect(document.body.textContent).toContain('Hidden');
    expect(document.querySelector('ul')).toBeNull();
  });
});

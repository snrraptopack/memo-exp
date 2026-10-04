import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { render, renderToString } from '@memoized-dom/server';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const policies = `
  function OuterPending() { return <i class="outer-pending">Loading</i>; }
  function InnerPending() { return <i class="inner-pending">Inner loading</i>; }
  function Failure({ error, retry }) {
    return <button class="failure" onClick={retry}>{error.message}</button>;
  }
  function OtherFailure({ error, retry }) {
    return <button class="other-failure" onClick={retry}>{error.message}</button>;
  }
`;
const modules = {
  './Leaf.tsx': `
    import { $fetch, Group } from '@memoized-dom/data';
    ${policies}
    export function Leaf() {
      const user = $fetch<{ name: string }>('/leaf');
      return <Group error={OtherFailure}><div id="leaf-value">{user.name}</div></Group>;
    }
    export function SuspendedLeaf() {
      const user = $fetch<{ name: string }>('/suspended-leaf');
      return <article suspend id="suspended-leaf"><h2>Private section</h2>{user.name}</article>;
    }
  `,
  './Bridge.tsx': `
    import { Group } from '@memoized-dom/data';
    import { Leaf, SuspendedLeaf } from './Leaf';
    export function Bridge() { return <Group><Leaf /></Group>; }
    export function SuspendedBridge() { return <SuspendedLeaf />; }
  `,
  './App.tsx': `
    import { $fetch, Group } from '@memoized-dom/data';
    import { Bridge, SuspendedBridge } from './Bridge';
    ${policies}
    function Child({ user }) { return <span class="child-value">{user.name}</span>; }
    function OwnChild() {
      const user = $fetch<{ name: string }>('/own');
      return <span class="own-value">{user.name}</span>;
    }
    export function MultipleChildren() {
      const user = $fetch<{ name: string }>('/user');
      return <Group pending={OuterPending} error={Failure}>
        literal text<header id="header">Static</header>
        <div id="value">{user.name}</div><Child user={user} />
        <footer id="footer">Footer</footer>
      </Group>;
    }
    export function NestedKeys() {
      const user = $fetch<{ name: string }>('/user');
      return <Group pending={OuterPending} error={Failure}>
        <Group pending={InnerPending}><span id="inner">{user.name}</span></Group>
        <Group error={OtherFailure}><Child user={user} /></Group>
      </Group>;
    }
    export function SeparateCallsites() {
      return <div>
        <Group pending={OuterPending}><OwnChild /></Group>
        <Group pending={InnerPending}><OwnChild /></Group>
      </div>;
    }
    export function AcrossFiles() {
      return <Group pending={OuterPending} error={Failure}><Bridge /></Group>;
    }
    export function AcrossFilesSuspended() {
      return <Group pending={OuterPending} error={Failure}>
        <h1 id="parent-heading">Parent stays</h1><SuspendedBridge />
      </Group>;
    }
    export function InlinePolicies() {
      const user = $fetch<{ name: string }>('/inline');
      let label = 'Waiting';
      return <Group pending={() => <i class="inline-pending">{label}</i>}
        error={({ error, retry }) => <button class="inline-error" onClick={retry}>{label}: {error.message}</button>}>
        <button id="change-label" onClick={() => { label = 'Still waiting'; }}>Change</button>
        <span id="inline-value">{user.name}</span>
      </Group>;
    }
    export function MixedForms() {
      const user = $fetch<{ name: string }>('/mixed');
      return <Group pending={OuterPending} error={Failure}>
        <section><Group pending={InnerPending}><span>{user.name}</span></Group></section>
      </Group>;
    }
    export function ReverseMixedForms() {
      const user = $fetch<{ name: string }>('/mixed');
      return <Group pending={OuterPending} error={OtherFailure}>
        <Group pending={InnerPending} error={Failure}>
          <span>{user.name}</span>
        </Group>
      </Group>;
    }
    export function EmptyPolicy() {
      const user = $fetch<{ name: string }>('/empty');
      return <Group><h1>Static</h1><span id="empty-value">{user.name}</span></Group>;
    }
  `,
};
type Factory = (id: string, parent: null) => Node;

describe('props-based Group policy scopes', () => {
  let fixture: Record<string, Factory>;
  let runtime: DataRuntime | undefined;
  let previous: DataRuntime | undefined;
  let requests: Array<{ url: string; resolve(response: Response): void }> = [];
  beforeAll(async () => {
    const compiled = compileModules(modules);
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'group-props');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(compiled)) {
      writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    }
    fixture = await import(pathToFileURL(join(directory, 'App.ts')).href);
  });
  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    document.body.replaceChildren();
    resetAccessTable();
    resetScheduler();
    if (previous !== undefined) setActiveDataRuntime(previous);
    runtime?.clear();
    runtime = undefined;
    previous = undefined;
    requests = [];
  });
  function mount(name: string) {
    runtime = createDataRuntime({ fetch: ((input: string | URL | Request) =>
      new Promise<Response>(resolve => requests.push({ url: String(input), resolve }))) as typeof fetch });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());
    document.body.append(fixture[name]!(name, null));
  }
  async function respond(body: unknown, status = 200) {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    requests.at(-1)!.resolve(new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }

  it('renders unrestricted static children while local and transported reads are pending', async () => {
    mount('MultipleChildren');
    expect(document.querySelector('#header')?.textContent).toBe('Static');
    expect(document.querySelector('#footer')?.textContent).toBe('Footer');
    expect(document.body.textContent).toContain('literal text');
    expect(document.querySelectorAll('.outer-pending')).toHaveLength(2);
    expect(document.querySelector('group')).toBeNull();
    await respond({ name: 'Ada' });
    await vi.waitFor(() => expect(document.querySelector('#value')?.textContent).toBe('Ada'));
    expect(document.querySelector('.child-value')?.textContent).toBe('Ada');
  });

  it('inherits pending and error independently through nested scopes', async () => {
    mount('NestedKeys');
    expect(document.querySelector('#inner .inner-pending')).not.toBeNull();
    expect(document.querySelector('.child-value .outer-pending')).not.toBeNull();
    await respond({ message: 'offline' }, 503);
    await vi.waitFor(() => expect(document.querySelector('#inner .failure')).not.toBeNull());
    expect(document.querySelector('.child-value .other-failure')).not.toBeNull();
  });

  it('resolves the same component under different policies per instance', async () => {
    mount('SeparateCallsites');
    expect(document.querySelectorAll('.outer-pending')).toHaveLength(1);
    expect(document.querySelectorAll('.inner-pending')).toHaveLength(1);
    await respond({ name: 'Ada' });
    await vi.waitFor(() => expect(document.querySelectorAll('.own-value')[0]?.textContent).toBe('Ada'));
    expect(document.querySelectorAll('.own-value')[1]?.textContent).toBe('Ada');
  });

  it('inherits missing keys across files and through an empty Group', async () => {
    mount('AcrossFiles');
    expect(document.querySelector('#leaf-value .outer-pending')).not.toBeNull();
    await respond({ message: 'offline' }, 503);
    await vi.waitFor(() => expect(document.querySelector('#leaf-value .other-failure')).not.toBeNull());
    expect(document.querySelector('.failure')).toBeNull();
    (document.querySelector('.other-failure') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    await respond({ name: 'Recovered' });
    await vi.waitFor(() => expect(document.querySelector('#leaf-value')?.textContent).toBe('Recovered'));
  });

  it('supports inline policies that capture reactive owner state', async () => {
    mount('InlinePolicies');
    expect(document.querySelector('.inline-pending')?.textContent).toBe('Waiting');
    (document.querySelector('#change-label') as HTMLButtonElement).click();
    expect(document.querySelector('.inline-pending')?.textContent).toBe('Still waiting');
    await respond({ message: 'offline' }, 503);
    await vi.waitFor(() => expect(document.querySelector('.inline-error')?.textContent).toContain('Still waiting'));
  });

  it('inherits suspension presentation across files without a child Group declaration', async () => {
    mount('AcrossFilesSuspended');
    expect(document.querySelector('#parent-heading')?.textContent).toBe('Parent stays');
    expect(document.querySelector('#suspended-leaf')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();
    await respond({ name: 'Ada' });
    await vi.waitFor(() => expect(document.querySelector('#suspended-leaf')?.textContent).toBe('Private sectionAda'));
    expect(document.querySelector('.outer-pending')).toBeNull();
  });

  it('preserves outer error policy when a nested scope overrides pending', async () => {
    mount('MixedForms');
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    await respond({ message: 'offline' }, 503);
    await vi.waitFor(() => expect(document.querySelector('.failure')).not.toBeNull());
  });

  it('diagnoses invalid policies and callbacks', () => {
    expect(() => compileModules({ './bad.tsx': `
      import { Group } from '@memoized-dom/data';
      export function App() { return <Group pending={async () => <i />} />; }
    ` })).toThrow(/must be synchronous/);
    expect(() => compileModules({ './bad.tsx': `
      import { Group } from '@memoized-dom/data';
      function Loading() { return <i />; }
      export function App() { return <Group pending={Loading} pending={Loading} />; }
    ` })).toThrow(/duplicate Group pending/);
    expect(() => compileModules({ './bad.tsx': `
      import { Group } from '@memoized-dom/data';
      export function App() { return <Group suspend={true}><i /></Group>; }
    ` })).toThrow(/suspend/);
  });

  it('lets inner scopes override both outer policies', async () => {
    mount('ReverseMixedForms');
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    expect(document.querySelector('.outer-pending')).toBeNull();
    await respond({ message: 'offline' }, 503);
    await vi.waitFor(() => expect(document.querySelector('.failure')).not.toBeNull());
    expect(document.querySelector('.other-failure')).toBeNull();
  });

  it('uses empty read slots without a pending policy', async () => {
    mount('EmptyPolicy');
    expect(document.querySelector('h1')?.textContent).toBe('Static');
    expect(document.querySelector('#empty-value')?.textContent).toBe('');
    await respond({ name: 'Ada' });
    await vi.waitFor(() => expect(document.querySelector('#empty-value')?.textContent).toBe('Ada'));
  });

  it('renders static shell content and inherited pending policies on the server', () => {
    const html = renderToString(fixture.MultipleChildren!, {
      fetch: (() => new Promise<Response>(() => {})) as typeof fetch,
    });
    expect(html).toContain('Static');
    expect(html).toContain('Footer');
    expect(html.match(/class="outer-pending"/g)).toHaveLength(2);
  });

  it('settles cross-file props-based scopes during resolved SSR', async () => {
    const { html } = await render(fixture.AcrossFiles!, {
      mode: 'resolve', fetch: (async () => new Response(JSON.stringify({ name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
    });
    expect(html).toContain('Ada');
    expect(html).not.toContain('outer-pending');
  });
});

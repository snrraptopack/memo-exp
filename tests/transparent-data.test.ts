import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  createDataRuntime,
  setActiveDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const fixture = join(outDir, 'transparent-data.compiled.ts');

const source = `
  import {
    $fetch,
    $track,
    Error,
    Group,
    Pending,
  } from '@memoized-dom/data';

  interface User {
    id: number;
    name: string;
  }

  function consumeName(name: string) {
    return name.length;
  }

  function InlinePending() {
    return <i class="pending">Loading</i>;
  }

  function InlineError({ error, retry }) {
    return <button class="data-error" onClick={retry}>{error.kind}</button>;
  }

  function TodoRowsPending() {
    return <li class="rows-pending">Rows loading</li>;
  }

  function TodoRowsError({ error, retry }) {
    return <li><button class="rows-error" onClick={retry}>{error.kind}</button></li>;
  }

  function DeepPending() {
    return <span class="deep-pending">Deep loading</span>;
  }

  function DeepError({ error, retry }) {
    return <button class="deep-error" onClick={retry}>{error.kind}</button>;
  }

  function CrossLeaf({ user }) {
    return <span id="cross-leaf">{user.name}</span>;
  }

  function CrossProfile({ user }) {
    const greeting = \`Welcome \${user.name}\`;
    return (
      <article id="cross-profile">
        <span id="cross-greeting">{greeting}</span>
        <Group data={user}>
          <Pending component={DeepPending} />
          <Error component={DeepError} />
          <CrossLeaf user={user} />
        </Group>
      </article>
    );
  }

  export function App() {
    const user = $fetch<User>('/user');
    const request = $track(user);
    const greeting = \`Hello \${user.name}\`;

    return (
      <main>
        <p if={request.pending}>Loading</p>
        <strong id="greeting">{greeting}</strong>
        <button id="rename" onClick={() => {
          user.name = 'Grace';
        }}>Rename</button>
        <button id="consume" onClick={() => consumeName(user.name)}>
          Consume
        </button>
      </main>
    );
  }

  export function GroupApp() {
    const user = $fetch<User>('/user');
    const statistics = $fetch<{ count: number }>('/statistics');

    return (
      <Group data={{ user, statistics }}>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <>
          <h1>Dashboard</h1>
          <strong id="group-user">{user.name}</strong>
          <output id="group-statistics">{statistics.count}</output>
        </>
      </Group>
    );
  }

  export function DerivedGroupApp() {
    const todos = $fetch<Array<{ id: number; title: string; done: boolean }>>('/todos');
    const open = todos.filter(todo => !todo.done);
    const count = open.length;

    return (
      <Group data={todos}>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <section>
          <h1>Todos</h1>
          <strong id="open-count">{count}</strong>
          <div id="open-state">
            {count > 0 ? <span>Open work</span> : <span>All done</span>}
          </div>
          <ul id="todo-rows">
            <Group data={todos}>
              <Pending component={TodoRowsPending} />
              <Error component={TodoRowsError} />
              {open.map(todo => <li key={todo.id}>{todo.title}</li>)}
            </Group>
          </ul>
        </section>
      </Group>
    );
  }

  export function CrossComponentApp() {
    const user = $fetch<User>('/cross-user');
    return (
      <Group data={user}>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <main>
          <h1>Cross component</h1>
          <CrossProfile user={user} />
        </main>
      </Group>
    );
  }

  export function UngroupedListApp() {
    const todos = $fetch<Array<{ id: number; title: string }>>('/ungrouped-todos');
    return (
      <section>
        <h1>Ungrouped</h1>
        <ul id="ungrouped-rows">
          {todos.map(todo => <li key={todo.id}>{todo.title}</li>)}
        </ul>
      </section>
    );
  }

  export function ReactiveQueryApp() {
    let search = 'Ada';
    const users = $fetch<User[]>('/users', { query: { search } });
    const request = $track(users);

    return (
      <main>
        <button id="same-query" onClick={() => search = 'Ada'}>Same</button>
        <button id="next-query" onClick={() => search = 'Grace'}>Next</button>
        <p if={request.pending}>Searching</p>
        <output id="query-result">{users[0].name}</output>
      </main>
    );
  }

  export function ReactiveTargetApp() {
    let userId = 1;
    const user = $fetch<User>(\`/users/\${userId}\`);

    return (
      <main>
        <button id="next-user" onClick={() => userId = 2}>Next user</button>
        <output id="target-result">{user.name}</output>
      </main>
    );
  }
`;

function importFixture(): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(fixture).href);
}

function countEntityRenders(id: string): () => number {
  const entity = _internals().registry.get(id);
  if (entity === undefined) throw new Error(`missing runtime entity: ${id}`);
  const render = entity.render;
  let count = 0;
  entity.render = reasons => {
    count++;
    render(reasons);
  };
  return () => count;
}

describe('compiler-transparent data values', () => {
  let runtime: DataRuntime | null = null;
  let previous: DataRuntime | null = null;

  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      { './transparent-data.tsx': source },
      { runtimePath: '@memoized-dom/runtime' },
    );
    const compiled = output['./transparent-data.tsx']!;
    expect(compiled).toContain('readResolvedValuesForRender');
    expect(compiled).toContain('connectResolvedValues');
    expect(compiled).toContain('ownResolvedValue');
    expect(compiled).toContain('/$data/0');
    expect(compiled).not.toContain('markDirtySubtree');
    expect(compiled).toContain('readResolvedValue(user, "user"');
    expect(compiled).toContain('rebindResolvedValue(users, \'/users\'');
    expect(compiled).toMatch(/const users = \$fetch\('\/users'/);
    expect(compiled).toContain('rebindResolvedValue(user, `/users/${userId}`');
    expect(compiled).not.toContain('volatile: true');
    writeFileSync(fixture, compiled);
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    document.body.replaceChildren();
    resetAccessTable();
    resetScheduler();
    if (previous !== null) setActiveDataRuntime(previous);
    runtime?.clear();
    runtime = null;
    previous = null;
  });

  it('keeps initial sites empty, replays derivations on push, and supports ordinary writes', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.App('App', null));
    const ownerRenders = countEntityRenders('App');
    const greetingRenders = countEntityRenders('App/$data/0');
    const pendingRenders = countEntityRenders('App/when0');

    expect(document.querySelector('p')?.textContent).toBe('Loading');
    expect(document.querySelector('#greeting')?.textContent).toBe('');

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify({ id: 1, name: 'Ada' }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect.poll(
      () => document.querySelector('#greeting')?.textContent,
    ).toBe('Hello Ada');
    expect(document.querySelector('p')).toBeNull();
    expect(ownerRenders()).toBe(0);
    expect(greetingRenders()).toBeGreaterThan(0);
    expect(pendingRenders()).toBeGreaterThan(0);

    document.querySelector<HTMLButtonElement>('#rename')!.click();
    expect(document.querySelector('#greeting')?.textContent)
      .toBe('Hello Grace');
  });

  it('applies Group policies independently at direct scalar consumption sites', async () => {
    const requests: Array<{
      url: string;
      resolve: (response: Response) => void;
    }> = [];
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) =>
        new Promise<Response>(resolve => {
          requests.push({ url: String(input), resolve });
        })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.GroupApp('GroupApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const ownerRenders = countEntityRenders('GroupApp');
    const userRenders = countEntityRenders('GroupApp/when0');
    const statisticsRenders = countEntityRenders('GroupApp/when1');

    expect(document.querySelector('h1')?.textContent).toBe('Dashboard');
    expect(document.querySelector('#group-user .pending')).not.toBeNull();
    expect(document.querySelector('#group-statistics .pending')).not.toBeNull();

    requests.find(request => request.url.endsWith('/user'))!.resolve(
      new Response(JSON.stringify({ id: 1, name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#group-user')?.textContent,
    ).toBe('Ada');
    expect(document.querySelector('#group-statistics .pending')).not.toBeNull();
    expect(ownerRenders()).toBe(0);
    expect(userRenders()).toBeGreaterThan(0);
    expect(statisticsRenders()).toBe(0);
    const userRendersAfterUser = userRenders();

    requests.find(request => request.url.endsWith('/statistics'))!.resolve(
      new Response(JSON.stringify({ message: 'offline' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#group-statistics .data-error')?.textContent,
    ).toBe('http');
    expect(document.querySelector('#group-user')?.textContent).toBe('Ada');
    expect(ownerRenders()).toBe(0);
    expect(userRenders()).toBe(userRendersAfterUser);
    expect(statisticsRenders()).toBeGreaterThan(0);

    document.querySelector<HTMLButtonElement>(
      '#group-statistics .data-error',
    )!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toMatch(/\/statistics$/);
    requests[2]!.resolve(
      new Response(JSON.stringify({ count: 42 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#group-statistics')?.textContent,
    ).toBe('42');
  });

  it('carries Group policy through derivations, conditions, lists, and nested overrides', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.DerivedGroupApp('DerivedGroupApp', null));
    const ownerRenders = countEntityRenders('DerivedGroupApp');

    expect(document.querySelector('h1')?.textContent).toBe('Todos');
    expect(document.querySelector('#open-count .pending')).not.toBeNull();
    expect(document.querySelector('#open-state .pending')).not.toBeNull();
    expect(document.querySelector('#todo-rows > .rows-pending')).not.toBeNull();

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify([
      { id: 1, title: 'Ship compiler', done: false },
      { id: 2, title: 'Archive draft', done: true },
    ]), { headers: { 'content-type': 'application/json' } }));

    await expect.poll(
      () => document.querySelector('#open-count')?.textContent,
    ).toBe('1');
    expect(document.querySelector('#open-state')?.textContent).toBe('Open work');
    expect(document.querySelector('#todo-rows')?.textContent).toBe('Ship compiler');
    expect(ownerRenders()).toBe(0);

  });

  it('reruns a fetch query without replacing its transparent binding', async () => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({
            url: String(input),
            signal: init!.signal!,
            resolve,
          });
        })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.ReactiveQueryApp('ReactiveQueryApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toMatch(/\/users\?search=Ada$/);
    expect(document.querySelector('#query-result')?.textContent).toBe('');

    document.querySelector<HTMLButtonElement>('#same-query')!.click();
    expect(requests).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('#next-query')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.url).toMatch(/\/users\?search=Grace$/);
    expect(document.querySelector('p')?.textContent).toBe('Searching');

    requests[1]!.resolve(new Response(JSON.stringify([
      { id: 2, name: 'Grace' },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#query-result')?.textContent,
    ).toBe('Grace');
    expect(document.querySelector('p')).toBeNull();

    requests[0]!.resolve(new Response(JSON.stringify([
      { id: 1, name: 'Ada' },
    ]), { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('#query-result')?.textContent).toBe('Grace');
  });

  it('reruns a fetch when a compiler-visible target interpolation changes', async () => {
    const requests: Array<{
      url: string;
      resolve: (response: Response) => void;
    }> = [];
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) =>
        new Promise<Response>(resolve => {
          requests.push({ url: String(input), resolve });
        })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.ReactiveTargetApp('ReactiveTargetApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toMatch(/\/users\/1$/);

    document.querySelector<HTMLButtonElement>('#next-user')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/users\/2$/);

    requests[1]!.resolve(new Response(JSON.stringify({
      id: 2,
      name: 'Grace',
    }), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#target-result')?.textContent,
    ).toBe('Grace');
  });

  it('routes a derived-source failure to each nearest Group policy before replay', async () => {
    const requests: Array<(response: Response) => void> = [];
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => {
        requests.push(resolve);
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.DerivedGroupApp('DerivedGroupErrorApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!(new Response(JSON.stringify({ message: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));

    await expect.poll(
      () => document.querySelector('#open-count .data-error')?.textContent,
    ).toBe('http');
    expect(document.querySelector('#open-state .data-error')).not.toBeNull();
    expect(document.querySelector('#todo-rows .rows-error')?.textContent).toBe('http');

    document.querySelector<HTMLButtonElement>('#todo-rows .rows-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!(new Response(JSON.stringify([
      { id: 1, title: 'Recovered', done: false },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#todo-rows')?.textContent,
    ).toBe('Recovered');
  });

  it('preserves a transparent source through component props and child derivations', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.CrossComponentApp('CrossComponentApp', null));
    const rootRenders = countEntityRenders('CrossComponentApp');
    const profileRenders = countEntityRenders(
      'CrossComponentApp/CrossProfile',
    );
    expect(document.querySelector('h1')?.textContent).toBe('Cross component');
    expect(document.querySelector('#cross-greeting .pending')).not.toBeNull();
    expect(document.querySelector('#cross-leaf .deep-pending')).not.toBeNull();

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify({ id: 1, name: 'Ada' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('#cross-greeting')?.textContent,
    ).toBe('Welcome Ada');
    expect(document.querySelector('#cross-leaf')?.textContent).toBe('Ada');
    expect(rootRenders()).toBe(0);
    expect(profileRenders()).toBe(0);
  });

  it('renders and retries inherited and nested cross-component Error policies', async () => {
    const requests: Array<(response: Response) => void> = [];
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => {
        requests.push(resolve);
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.CrossComponentApp('CrossComponentErrorApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!(new Response(JSON.stringify({ message: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));

    await expect.poll(
      () => document.querySelector('#cross-greeting .data-error')?.textContent,
    ).toBe('http');
    expect(document.querySelector('#cross-leaf .deep-error')?.textContent).toBe('http');

    document.querySelector<HTMLButtonElement>('#cross-leaf .deep-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!(new Response(JSON.stringify({ id: 2, name: 'Recovered' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('#cross-leaf')?.textContent,
    ).toBe('Recovered');
    expect(document.querySelector('#cross-greeting')?.textContent)
      .toBe('Welcome Recovered');
  });

  it('links transparent provenance and Group policy across modules', async () => {
    const modules = compileModules({
      './transparent-cross/profile.tsx': `
        export function RemoteProfile({ user }) {
          const label = \`Remote \${user.name}\`;
          return <h2 id="remote-profile">{label}</h2>;
        }
      `,
      './transparent-cross/app.tsx': `
        import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
        import { RemoteProfile } from './profile';
        function Loading() { return <i class="remote-pending">Loading</i>; }
        function Failed({ error, retry }) {
          return <button class="remote-error" onClick={retry}>{error.kind}</button>;
        }
        export function RemoteApp() {
          const user = $fetch('/remote-user');
          return (
            <Group data={user}>
              <Pending component={Loading} />
              <Error component={Failed} />
              <RemoteProfile user={user} />
            </Group>
          );
        }
      `,
    }, { runtimePath: '@memoized-dom/runtime' });
    const crossDir = join(outDir, 'transparent-cross');
    mkdirSync(crossDir, { recursive: true });
    writeFileSync(join(crossDir, 'profile.ts'), modules['./transparent-cross/profile.tsx']!);
    writeFileSync(join(crossDir, 'app.ts'), modules['./transparent-cross/app.tsx']!);

    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await import(/* @vite-ignore */ pathToFileURL(
      join(crossDir, 'app.ts'),
    ).href);
    document.body.appendChild(mod.RemoteApp('RemoteApp', null));
    expect(document.querySelector('#remote-profile .remote-pending')).not.toBeNull();

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify({ name: 'Linked' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('#remote-profile')?.textContent,
    ).toBe('Remote Linked');
  });

  it('keeps an ungrouped structural site empty until its source commits', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.UngroupedListApp('UngroupedListApp', null));
    expect(document.querySelector('h1')?.textContent).toBe('Ungrouped');
    expect(document.querySelector('#ungrouped-rows')?.textContent).toBe('');

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify([
      { id: 1, title: 'One' },
      { id: 2, title: 'Two' },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#ungrouped-rows')?.textContent,
    ).toBe('OneTwo');
  });

  it('requires Pending, Error, and one content child in Group', () => {
    expect(() => compileModules({
      './invalid-group.tsx': `
        import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
        function Loading() { return <i>Loading</i>; }
        function Failed() { return <i>Failed</i>; }
        export function InvalidGroup() {
          const user = $fetch<{ name: string }>('/user');
          return (
            <Group data={user}>
              <Pending component={Loading} />
              <Error component={Failed} />
              <strong>{user.name}</strong>
              <small>extra direct content</small>
            </Group>
          );
        }
      `,
    })).toThrow(/Group requires exactly three direct children/);
  });

  it('requires Group policy declarations in Pending then Error order', () => {
    expect(() => compileModules({
      './invalid-group-order.tsx': `
        import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
        function Loading() { return <i>Loading</i>; }
        function Failed() { return <i>Failed</i>; }
        export function InvalidGroupOrder() {
          const user = $fetch<{ name: string }>('/user');
          return (
            <Group data={user}>
              <Error component={Failed} />
              <Pending component={Loading} />
              <strong>{user.name}</strong>
            </Group>
          );
        }
      `,
    })).toThrow(/Group child must be <Pending/);
  });
});

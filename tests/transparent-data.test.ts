import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules, diagnoseModules } from '@memoized-dom/compiler';
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
const tsrxFixture = join(outDir, 'transparent-data-tsrx.compiled.ts');

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

  function CrossList({ tasks }) {
    const open = tasks
      .filter((task) => !task.done)
      .sort((left, right) => left.id - right.id);
    return (
      <ul id="cross-list">
        {open.map((task) => <li key={task.id}>{task.title}</li>)}
      </ul>
    );
  }

  function GenericPropsView(props) {
    const open = props.payload.tasks
      .filter((task) => !task.done)
      .sort((left, right) => left.id - right.id);
    const formatted = props.payload.total.toLocaleString();
    return (
      <section id="generic-props-view">
        <output>{formatted}</output>
        <ul>{open.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
      </section>
    );
  }

  function OwnedSourceChild() {
    const tasks = $fetch<Array<{ id: number; title: string }>>('/owned-tasks');
    return (
      <ul id="owned-source-list">
        {tasks.map((task) => <li key={task.id}>{task.title}</li>)}
      </ul>
    );
  }

  function CrossProfile({ user }) {
    const greeting = \`Welcome \${user.name}\`;
    return (
      <article id="cross-profile">
        <span id="cross-greeting">{greeting}</span>
        <Group>
          <Pending component={DeepPending} />
          <Error component={DeepError} />
          <CrossLeaf user={user} />
        </Group>
      </article>
    );
  }

  function SuspendedDashboard({ user, statistics }) {
    return (
      <section id="suspended-dashboard">
        <strong>{user.name}</strong>
        <output>{statistics.count}</output>
      </section>
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
      <Group>
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

  export function InferredInlineGroupApp() {
    const user = $fetch<User>('/inline-user');
    const waiting = 'Waiting inline';

    return (
      <Group>
        <Pending component={() => <i class="inline-callback-pending">{waiting}</i>} />
        <Error component={({ error, retry }) => (
          <button class="inline-callback-error" onClick={retry}>{error.kind}</button>
        )} />
        <section suspend id="inline-suspended-content">{user.name}</section>
      </Group>
    );
  }

  export function SuspendedGroupApp() {
    const user = $fetch<User>('/suspended-user');
    const statistics = $fetch<{ count: number }>('/suspended-statistics');

    return (
      <Group>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <SuspendedDashboard suspend user={user} statistics={statistics} />
      </Group>
    );
  }

  export function DerivedGroupApp() {
    const todos = $fetch<Array<{ id: number; title: string; done: boolean }>>('/todos');
    const open = todos.filter(todo => !todo.done);
    const count = open.length;

    return (
      <Group>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <section>
          <h1>Todos</h1>
          <strong id="open-count">{count}</strong>
          <div id="open-state">
            {count > 0 ? <span>Open work</span> : <span>All done</span>}
          </div>
          <ul id="todo-rows">
            <Group>
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
      <Group>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <main>
          <h1>Cross component</h1>
          <CrossProfile user={user} />
        </main>
      </Group>
    );
  }

  export function NestedCallbackGroupApp() {
    const projects = $fetch<Array<{ id: number; name: string }>>('/nested-projects');
    const tasks = $fetch<Array<{ id: number; projectId: number }>>('/nested-tasks');
    const cards = projects.map(project => ({
      project,
      count: tasks.filter(task => task.projectId === project.id).length,
    }));

    return (
      <Group>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <ul id="nested-cards">
          {cards.map(card => <li key={card.project.id}>{card.project.name}:{card.count}</li>)}
        </ul>
      </Group>
    );
  }

  export function CrossCollectionApp() {
    const tasks = $fetch<Array<{ id: number; title: string; done: boolean }>>('/cross-tasks');
    return (
      <Group>
        <Pending component={InlinePending} />
        <Error component={InlineError} />
        <CrossList tasks={tasks} />
      </Group>
    );
  }

  export function GenericPropsApp() {
    const payload = $fetch<{
      total: number;
      tasks: Array<{ id: number; title: string; done: boolean }>;
    }>('/generic-props');
    return <GenericPropsView payload={payload} />;
  }

  export function DescendantOwnedGroupApp() {
    return (
      <Group>
        <Pending component={DeepPending} />
        <Error component={DeepError} />
        <main id="owned-source-shell"><OwnedSourceChild /></main>
      </Group>
    );
  }

  export function SourceMutationApp() {
    const tasks = $fetch<Array<{ id: string; title: string }>>('/mutable-tasks');
    const visible = tasks.filter((task) => task.id !== 'hidden');
    let draggedId: string | null = null;
    function removeFirst() {
      tasks.splice(0, 1);
    }
    function moveDragged() {
      if (draggedId === null) return;
      const task = tasks.find((candidate) => candidate.id === draggedId);
      draggedId = null;
      if (task !== undefined) task.title = 'Moved';
    }
    return (
      <main>
        <button id="remove-source-row" onClick={removeFirst}>Remove</button>
        <p if={visible.length === 0} id="mutable-source-empty">Empty</p>
        <ul id="mutable-source-list">
          {visible.map((task) => (
            <li
              key={task.id}
              class="mutable-source-row"
              draggable
              onDragStart={() => {
                draggedId = task.id;
              }}
            >
              {task.title}
            </li>
          ))}
        </ul>
        <div
          id="mutable-source-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            moveDragged();
          }}
        >
          Drop
        </div>
      </main>
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

const tsrxSource = `
  import { $fetch } from '@memoized-dom/data';

  interface User { name: string; }
  interface Statistics { count: number; }

  function Dashboard({ user, statistics }: {
    user: User;
    statistics: Statistics;
  }) @{
    <section id="tsrx-suspended-dashboard">
      <strong>{user.name}</strong>
      <output>{statistics.count}</output>
    </section>
  }

  function ColorlessDashboard({ user, statistics }: {
    user: User;
    statistics: Statistics;
  }) @{
    <section id="tsrx-colorless-dashboard">
      <h2>Colorless dashboard</h2>
      <strong id="tsrx-colorless-user">{user.name}</strong>
      <output id="tsrx-colorless-statistics">{statistics.count}</output>
    </section>
  }

  export function SuspendedTsrxApp() @{
    const user = $fetch<User>('/tsrx-suspended-user');
    const statistics = $fetch<Statistics>('/tsrx-suspended-statistics');

    @try {
      <Dashboard suspend {user} {statistics} />
    } @pending {
      <p class="tsrx-pending">Loading TSRX dashboard</p>
    } @catch (error, reset) {
      <button class="tsrx-error" onClick={reset}>{error.message}</button>
    }
  }

  export function ColorlessTsrxApp() @{
    const user = $fetch<User>('/tsrx-colorless-user');
    const statistics = $fetch<Statistics>('/tsrx-colorless-statistics');
    const pendingLabel = 'locally';
    const failureLabel = 'Colorless failure';

    @try {
      <ColorlessDashboard {user} {statistics} />
    } @pending {
      <i class="tsrx-colorless-pending">Waiting {pendingLabel}</i>
    } @catch (error, reset) {
      <button class="tsrx-colorless-error" onClick={reset}>
        {failureLabel}: {error.message}
      </button>
    }
  }
`;

type CompiledFixture = Record<string, (id: string, parent: null) => Node>;

function importFixture(): Promise<CompiledFixture> {
  return import(/* @vite-ignore */ pathToFileURL(fixture).href);
}

interface CompiledTsrxFixture {
  SuspendedTsrxApp(id: string, parent: null): Node;
  ColorlessTsrxApp(id: string, parent: null): Node;
}

function importTsrxFixture(): Promise<CompiledTsrxFixture> {
  return import(/* @vite-ignore */ pathToFileURL(tsrxFixture).href);
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
      {
        './transparent-data.tsx': source,
        './transparent-data.tsrx': tsrxSource,
      },
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
    expect(compiled).toContain(
      'resolvedValuesPending([projects, tasks])',
    );
    writeFileSync(fixture, compiled);
    writeFileSync(
      tsrxFixture,
      output['./transparent-data.tsrx']!,
    );
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

  it('infers Group data and supports direct host suspension with inline policies', async () => {
    const requests: Array<(response: Response) => void> = [];
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => {
        requests.push(resolve);
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(
      mod.InferredInlineGroupApp('InferredInlineGroupApp', null),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(document.querySelector('.inline-callback-pending')?.textContent)
      .toBe('Waiting inline');
    expect(document.querySelector('#inline-suspended-content')).toBeNull();

    requests[0]!(new Response(JSON.stringify({ message: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('.inline-callback-error')?.textContent,
    ).toBe('http');

    document.querySelector<HTMLButtonElement>('.inline-callback-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!(new Response(JSON.stringify({ id: 1, name: 'Ada' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('#inline-suspended-content')?.textContent,
    ).toBe('Ada');
  });

  it('atomically mounts a suspended Group component after all initial data commits', async () => {
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
    document.body.appendChild(mod.SuspendedGroupApp('SuspendedGroupApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(document.querySelectorAll('.pending')).toHaveLength(1);
    expect(document.querySelector('#suspended-dashboard')).toBeNull();

    requests.find(request => request.url.endsWith('/suspended-user'))!.resolve(
      new Response(JSON.stringify({ id: 1, name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.pending')).toHaveLength(1);
    });
    expect(document.querySelector('#suspended-dashboard')).toBeNull();

    requests.find(
      request => request.url.endsWith('/suspended-statistics'),
    )!.resolve(
      new Response(JSON.stringify({ count: 42 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#suspended-dashboard')?.textContent,
    ).toBe('Ada42');
    expect(document.querySelector('.pending')).toBeNull();
  });

  it('mounts a suspended TSRX @try component after all initial data commits', async () => {
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

    const mod = await importTsrxFixture();
    document.body.appendChild(
      mod.SuspendedTsrxApp('SuspendedTsrxApp', null),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(document.querySelectorAll('.tsrx-pending')).toHaveLength(1);
    expect(document.querySelector('#tsrx-suspended-dashboard')).toBeNull();

    requests.find(
      request => request.url.endsWith('/tsrx-suspended-user'),
    )!.resolve(
      new Response(JSON.stringify({ name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.tsrx-pending')).toHaveLength(1);
    });

    requests.find(
      request => request.url.endsWith('/tsrx-suspended-statistics'),
    )!.resolve(
      new Response(JSON.stringify({ count: 42 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-suspended-dashboard')?.textContent,
    ).toBe('Ada42');
    expect(document.querySelector('.tsrx-pending')).toBeNull();
  });

  it('keeps a TSRX @try component colorless when suspend is absent', async () => {
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

    const mod = await importTsrxFixture();
    document.body.appendChild(mod.ColorlessTsrxApp('ColorlessTsrxApp', null));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(document.querySelector('#tsrx-colorless-dashboard h2')?.textContent)
      .toBe('Colorless dashboard');
    expect(document.querySelector('#tsrx-colorless-user')?.textContent)
      .toBe('Waiting locally');
    expect(document.querySelector('#tsrx-colorless-statistics')?.textContent)
      .toBe('Waiting locally');
    expect(document.querySelectorAll('.tsrx-colorless-pending')).toHaveLength(2);

    requests.find(
      request => request.url.endsWith('/tsrx-colorless-user'),
    )!.resolve(
      new Response(JSON.stringify({ name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-colorless-user')?.textContent,
    ).toBe('Ada');
    expect(document.querySelector('#tsrx-colorless-statistics')?.textContent)
      .toBe('Waiting locally');
    expect(document.querySelectorAll('.tsrx-colorless-pending')).toHaveLength(1);

    requests.find(
      request => request.url.endsWith('/tsrx-colorless-statistics'),
    )!.resolve(
      new Response(JSON.stringify({ count: 42 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-colorless-statistics')?.textContent,
    ).toBe('42');
    expect(document.querySelector('.tsrx-colorless-pending')).toBeNull();
  });

  it('routes an unsuspended TSRX failure to only its colorless site', async () => {
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

    const mod = await importTsrxFixture();
    document.body.appendChild(mod.ColorlessTsrxApp('ColorlessTsrxError', null));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests.find(
      request => request.url.endsWith('/tsrx-colorless-user'),
    )!.resolve(
      new Response(JSON.stringify({ message: 'offline' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-colorless-user')?.textContent,
    ).toContain('Colorless failure:');
    expect(document.querySelector('#tsrx-colorless-statistics')?.textContent)
      .toBe('Waiting locally');

    document.querySelector<HTMLButtonElement>('.tsrx-colorless-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toMatch(/\/tsrx-colorless-user$/);
    requests[2]!.resolve(
      new Response(JSON.stringify({ name: 'Recovered' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-colorless-user')?.textContent,
    ).toBe('Recovered');
    expect(document.querySelector('#tsrx-colorless-statistics')?.textContent)
      .toBe('Waiting locally');
  });

  it('routes a suspended TSRX data failure through catch and reset', async () => {
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

    const mod = await importTsrxFixture();
    document.body.appendChild(
      mod.SuspendedTsrxApp('SuspendedTsrxErrorApp', null),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests.find(
      request => request.url.endsWith('/tsrx-suspended-user'),
    )!.resolve(
      new Response(JSON.stringify({ message: 'offline' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('.tsrx-error')?.textContent,
    ).toContain('503');
    expect(document.querySelector('#tsrx-suspended-dashboard')).toBeNull();

    document.querySelector<HTMLButtonElement>('.tsrx-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toMatch(/\/tsrx-suspended-user$/);
    requests[2]!.resolve(
      new Response(JSON.stringify({ name: 'Recovered' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelectorAll('.tsrx-pending').length,
    ).toBe(1);

    requests.find(
      request => request.url.endsWith('/tsrx-suspended-statistics'),
    )!.resolve(
      new Response(JSON.stringify({ count: 7 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect.poll(
      () => document.querySelector('#tsrx-suspended-dashboard')?.textContent,
    ).toBe('Recovered7');
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
        export function RemoteProfile(props) {
          const label = \`Remote \${props.user.name}\`;
          const visibleRoles = props.user.roles.filter(role => role.visible);
          return (
            <h2 id="remote-profile">
              {label}:{visibleRoles.map(role => <span key={role.id}>{role.name}</span>)}
            </h2>
          );
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
            <Group>
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
    resolve(new Response(JSON.stringify({
      name: 'Linked',
      roles: [
        { id: 1, name: 'reader', visible: true },
        { id: 2, name: 'hidden', visible: false },
      ],
    }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect.poll(
      () => document.querySelector('#remote-profile')?.textContent,
    ).toBe('Remote Linked:reader');
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
            <Group>
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
            <Group>
              <Error component={Failed} />
              <Pending component={Loading} />
              <strong>{user.name}</strong>
            </Group>
          );
        }
      `,
    })).toThrow(/Group child must be <Pending/);
  });

  it('waits for every source read inside an immediate derivation callback', async () => {
    const requests = new Map<string, (response: Response) => void>();
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) => new Promise<Response>(resolve => {
        requests.set(String(input), resolve);
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.NestedCallbackGroupApp('NestedCallbackGroupApp', null));
    await vi.waitFor(() => expect(requests.size).toBe(2));
    expect(document.querySelector('#nested-cards > .pending')).not.toBeNull();
    const resolveRequest = (path: string): ((response: Response) => void) =>
      [...requests].find(([url]) => url.endsWith(path))![1];

    resolveRequest('/nested-projects')(new Response(JSON.stringify([
      { id: 1, name: 'Compiler' },
    ]), { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('#nested-cards > .pending')).not.toBeNull();

    resolveRequest('/nested-tasks')(new Response(JSON.stringify([
      { id: 1, projectId: 1 },
      { id: 2, projectId: 1 },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#nested-cards')?.textContent,
    ).toBe('Compiler:2');
  });

  it('defers collection methods on a transparent source passed through props', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(
      mod.CrossCollectionApp('CrossCollectionApp', null),
    );
    expect(document.querySelector('#cross-list .pending')).not.toBeNull();

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify([
      { id: 3, title: 'Closed', done: true },
      { id: 2, title: 'Second', done: false },
      { id: 1, title: 'First', done: false },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#cross-list')?.textContent,
    ).toBe('FirstSecond');
  });

  it('preserves transparent provenance through a generic props object', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    expect(() => {
      document.body.appendChild(
        mod.GenericPropsApp('GenericPropsApp', null),
      );
    }).not.toThrow();
    expect(document.querySelector('#generic-props-view')?.textContent).toBe('');

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify({
      total: 12345,
      tasks: [
        { id: 3, title: 'Closed', done: true },
        { id: 2, title: 'Second', done: false },
        { id: 1, title: 'First', done: false },
      ],
    }), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#generic-props-view')?.textContent,
    ).toBe('12,345FirstSecond');
  });

  it('inherits Group presentation through a descendant-owned source', async () => {
    let resolve!: (response: Response) => void;
    runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(
      mod.DescendantOwnedGroupApp('DescendantOwnedGroupApp', null),
    );
    expect(document.querySelector('#owned-source-shell')).not.toBeNull();
    expect(document.querySelector('#owned-source-list .deep-pending')).not.toBeNull();

    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(new Response(JSON.stringify([
      { id: 2, title: 'Second' },
      { id: 1, title: 'First' },
    ]), { headers: { 'content-type': 'application/json' } }));
    await expect.poll(
      () => document.querySelector('#owned-source-list')?.textContent,
    ).toBe('SecondFirst');
  });

  it('publishes direct source payload mutations to dependent list regions', async () => {
    runtime = createDataRuntime({
      fetch: (() => Promise.resolve(new Response(JSON.stringify([
        { id: 'one', title: 'First' },
        { id: 'two', title: 'Second' },
      ]), { headers: { 'content-type': 'application/json' } }))) as typeof fetch,
    });
    previous = setActiveDataRuntime(runtime);
    setScheduler(run => run());

    const mod = await importFixture();
    document.body.appendChild(mod.SourceMutationApp('SourceMutationApp', null));
    await expect.poll(
      () => document.querySelector('#mutable-source-list')?.textContent,
    ).toBe('FirstSecond');

    const rows = document.querySelectorAll<HTMLElement>('.mutable-source-row');
    rows[1]!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    document.querySelector<HTMLElement>('#mutable-source-drop')!
      .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    expect(document.querySelector('#mutable-source-list')?.textContent)
      .toBe('FirstMoved');

    document.querySelector<HTMLButtonElement>('#remove-source-row')!.click();
    expect(document.querySelector('#mutable-source-list')?.textContent)
      .toBe('Moved');
    expect(document.querySelector('#mutable-source-empty')).toBeNull();
  });

  it('rejects the removed Group data prop', () => {
    expect(() => compileModules({
      './invalid-group-data.tsx': `
        import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
        function Loading() { return <i>Loading</i>; }
        function Failed() { return <i>Failed</i>; }
        export function InvalidGroupData() {
          const user = $fetch<{ name: string }>('/user');
          return (
            <Group data={user}>
              <Pending component={Loading} />
              <Error component={Failed} />
              <strong>{user.name}</strong>
            </Group>
          );
        }
      `,
    })).toThrow(/Group infers colorless sources from its content; remove the data prop/);
  });

  it('requires suspend to be a shorthand direct Group child', () => {
    const invalidSuspend = `
        function Dashboard() { return <main>Dashboard</main>; }
        export function App() { return <Dashboard suspend />; }
      `;
    const diagnostics = diagnoseModules({
      './invalid-suspend.tsx': invalidSuspend,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(
      /suspend requires the element to be the direct content child of Group/,
    );
    expect(diagnostics[0]?.moduleId).toBe('./invalid-suspend.tsx');
    expect(diagnostics[0]?.line).toBe(
      invalidSuspend.slice(0, invalidSuspend.indexOf('suspend')).split('\n').length,
    );
    expect(diagnostics[0]?.column).toBeGreaterThan(0);

    expect(() => compileModules({
      './invalid-suspend-value.tsx': `
        import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
        function Loading() { return <i>Loading</i>; }
        function Failed() { return <i>Failed</i>; }
        function Dashboard() { return <main>Dashboard</main>; }
        export function App() {
          const user = $fetch<{ name: string }>('/user');
          return (
            <Group>
              <Pending component={Loading} />
              <Error component={Failed} />
              <Dashboard suspend={true} />
            </Group>
          );
        }
      `,
    })).toThrow(/write 'suspend' without a value/);
  });
});

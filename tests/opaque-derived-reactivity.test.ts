/**
 * Regression coverage for opaque-rooted reactivity.
 *
 * These scenarios failed together in application testing:
 *  1. Const chains rooted at opaque values ($fetch handles) compiled to
 *     factory-time constants, so resource-backed lists never updated and
 *     optimistic mutations stayed invisible (fixed: such chains now qualify
 *     as per-instance derivations and replay on every update).
 *  2. Opaque INVOCATIONS replayed per update after the derivation fix went
 *     in too broadly — `$fetch()` must stay factory-time (snapshot rules:
 *     bare-value use, invocation, and argument pass-through never qualify).
 *  3. Field writes through JSX ref bindings (`canvas.width = x`) were treated
 *     as reactive writes of the binding, so ref-using effects invalidated
 *     their own owner every frame and tripped the commit cascade guard
 *     (fixed: ref bindings are excluded from instance state).
 *  4. Component-level helpers mutating an item field emitted row-scoped
 *     commit identifiers into component-scope code — `ReferenceError:
 *     _rowId3` on click (fixed: name-resolved handlers and reachable helpers
 *     are analyzed without the caller's row context).
 */
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
const fixture = join(outDir, 'opaque-derived-reactivity.compiled.ts');

const source = `
  import { createDataRuntime } from '@memoized-dom/data';

  const requests = [];
  export function requestCount() { return requests.length; }
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

  export let effectRuns = 0;

  export function TaskBoard() {
    const api = createDataRuntime({ fetch: mockFetch });
    const res = api.\$fetch('/todos');
    cleanup(api.clear);

    let statusFilter = 'all';
    const rawList = res.data?.todos ?? [];
    const totalTasks = rawList.length;
    const openCount = totalTasks - rawList.filter((t) => t.completed).length;
    const visibleTasks = rawList.filter((t) => !t.completed);

    function addOptimistic(title) {
      res.mutate((current) => {
        current?.todos.unshift({
          id: Date.now(),
          todo: title,
          completed: false,
        });
      });
    }

    return <main>
      <output id="status">{res.status}</output>
      <output id="total">{totalTasks}</output>
      <output id="open">{openCount}</output>
      <output id="visible">{visibleTasks.length}</output>
      <ul>{visibleTasks.map((task) =>
        <li key={task.id}>{task.todo}</li>
      )}</ul>
      <button id="add" onClick={() => addOptimistic('Probe task')}>Add</button>
    </main>;
  }

  export function CanvasPanel() {
    const telemetry = createDataRuntime({ fetch: mockFetch });
    const stats = telemetry.$fetch('/stats');
    cleanup(telemetry.clear);
    let canvas;
    effect(() => {
      effectRuns++;
      if (!canvas) return;
      canvas.width = canvas.clientWidth + 1;
      return () => {};
    });
    return <div>
      <output id="load">{stats.data?.load ?? 0}</output>
      <canvas ref={canvas}></canvas>
    </div>;
  }

  export function HelperBoard() {
    const api = createDataRuntime({ fetch: mockFetch });
    const res = api.\$fetch('/items');
    cleanup(api.clear);

    function toggleItem(item) {
      item.done = !item.done;
    }

    const items = res.data ?? [];

    return <ul id="helper-list">{items.map((item) =>
      <li key={item.id}>
        <button onClick={() => toggleItem(item)}>
          {item.done ? 'done' : 'open'}
        </button>
      </li>
    )}</ul>;
  }

  // Non-volatile list over instance state. The mutation fires outside any
  // event handler, so no event-origin commit exists — the ONLY invalidation
  // is the parameter effect folded from the helper into the call site.
  // Before the fix the row stayed stale forever.
  export function LocalBoard() {
    let items = [
      { id: 1, done: false },
      { id: 2, done: false },
    ];

    function toggleItem(item) {
      item.done = !item.done;
    }

    let scheduled = false;
    function scheduleToggle(item) {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => toggleItem(item), 30);
    }

    return <ul id="local-list">{items.map((item) =>
      <li key={item.id}>
        <button onClick={() => scheduleToggle(item)}>
          {item.done ? 'done' : 'open'}
        </button>
      </li>
    )}</ul>;
  }
`;

function importFixture(): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(fixture).href);
}

describe('opaque-derived reactivity regressions', () => {
  const frames: FrameRequestCallback[] = [];

  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      { './opaque-derived-reactivity.tsx': source },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(fixture, output['./opaque-derived-reactivity.tsx']!);
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
    await Promise.resolve();
  }

  it('replays opaque-rooted derivation chains: lists, counters, and optimistic mutations update', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.TaskBoard('App', null));

    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    mod.resolveRequest(0, {
      todos: [
        { id: 1, todo: 'Alpha', completed: false },
        { id: 2, todo: 'Beta', completed: true },
      ],
    });
    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelector('#status')?.textContent).toBe('success');
    });

    await pullFrame();
    expect(document.querySelector('#total')?.textContent).toBe('2');
    expect(document.querySelector('#open')?.textContent).toBe('1');
    expect(
      [...document.querySelectorAll('li')].map((node) => node.textContent),
    ).toEqual(['Alpha']);

    // Optimistic mutation: the new task must appear without any refetch.
    document.querySelector<HTMLButtonElement>('#add')!.click();
    await pullFrame();

    expect(document.querySelector('#total')?.textContent).toBe('3');
    expect(document.querySelector('#visible')?.textContent).toBe('2');
    expect(
      [...document.querySelectorAll('li')].map((node) => node.textContent),
    ).toEqual(['Probe task', 'Alpha']);
    // No additional GET: mutations are local until an action refreshes.
    expect(mod.requestCount()).toBe(1);
  });

  it('keeps opaque invocations factory-time: $fetch never replays per update', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.TaskBoard('App', null));

    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    mod.resolveRequest(0, { todos: [{ id: 1, todo: 'Alpha', completed: false }] });

    // Several volatile pull frames must not construct new resources.
    await pullFrame();
    await pullFrame();
    await pullFrame();

    expect(mod.requestCount()).toBe(1);
    expect(_internals().volatileSet.has('App')).toBe(true);
  });

  it('does not cascade when an effect writes fields through a JSX ref binding', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.CanvasPanel('App', null));

    // Drain the mount frame plus a few volatile pull frames.
    await pullFrame();
    await pullFrame();
    await pullFrame();
    const runsAfterWarmup = mod.effectRuns;
    expect(runsAfterWarmup).toBeGreaterThanOrEqual(1);

    // The effect must NOT re-run per frame: field writes through the ref are
    // external DOM mutation, not reactive writes of the binding. Before the
    // fix this looped the commit cascade guard every animation frame.
    await pullFrame();
    await pullFrame();
    await pullFrame();

    expect(mod.effectRuns).toBe(runsAfterWarmup);
  });

  it('lets a component-level helper mutate an item field without escaping row scope', async () => {
    const mod = await importFixture();
    document.body.appendChild(mod.HelperBoard('HelperApp', null));

    await vi.waitFor(() => expect(mod.requestCount()).toBe(1));
    mod.resolveRequest(0, [
      { id: 1, done: false },
      { id: 2, done: false },
    ]);
    await vi.waitFor(async () => {
      await pullFrame();
      expect(document.querySelectorAll('button').length).toBe(2);
    });

    const buttons = () =>
      [...document.querySelectorAll('button')].map(
        (node) => node.textContent,
      );
    expect(buttons()).toEqual(['open', 'open']);

    // Before the fix this threw `ReferenceError: _rowId3 is not defined`
    // because the helper's row-relative commit referenced a row-factory
    // identifier from component scope.
    document.querySelectorAll('button')[0]!.click();
    await vi.waitFor(async () => {
      await pullFrame();
      expect(buttons()).toEqual(['done', 'open']);
    });
  });

  it("folds helper parameter effects into the call site's row scope", async () => {
    // Emission-level assertion: the row's onClick arrow must carry the row
    // commit folded from toggleItem (via scheduleToggle's transitive
    // parameter effects). Before the fix the helper emitted a row-scoped
    // identifier in component scope (ReferenceError) and the call site
    // emitted nothing.
    const { readFileSync } = await import('node:fs');
    const emitted = readFileSync(fixture, 'utf8');
    expect(emitted).toContain('_MD.markDirty(_rowId2)');
  });
});

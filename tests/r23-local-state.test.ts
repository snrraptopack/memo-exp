/**
 * R23 verifies collection-agnostic instance state and async named helpers.
 *
 * Lists consume ordered local views while arrays, objects, Maps, and Sets all
 * retain the same owner-level invalidation and derivation semantics.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCES: Record<string, string> = {
  'r23-array-row': `
    function Row(item) {
      return <button class="row" onClick={() => item.title += "!"}>
        {item.title}
      </button>;
    }
    export function App() {
      let todos = [{ id: 1, title: "a" }];
      const titles = todos.map(todo => todo.title).join(",");
      return <main>
        <output id="titles">{titles}</output>
        <button id="add" onClick={() =>
          todos.push({ id: 2, title: "b" })
        }>add</button>
        <div>{todos.map(todo =>
          <Row key={todo.id} item={todo} />
        )}</div>
      </main>;
    }
  `,
  'r23-object-path': `
    export function App() {
      const state = { todos: [{ id: 1, title: "a" }] };
      return <main>
        <button id="add" onClick={() =>
          state.todos.push({ id: 2, title: "b" })
        }>add</button>
        <div>{state.todos.map(todo =>
          <span key={todo.id}>{todo.title}</span>
        )}</div>
      </main>;
    }
  `,
  'r23-collections': `
    class Box {
      value;
      constructor(value) { this.value = value; }
      get() { return this.value; }
      set(value) { this.value = value; }
    }
    export function App() {
      const labels = new Map([[1, "a"]]);
      const selected = new Set(["x"]);
      const record = { first: 1 };
      const token = {};
      const weakLabels = new WeakMap([[token, "weak-a"]]);
      const weakSelected = new WeakSet([token]);
      const box = new Box("box-a");
      const mapRows = Array.from(labels, ([id, title]) => ({ id, title }));
      const setRows = Array.from(selected, value => ({ id: value, value }));
      const objectRows = Object.entries(record).map(([id, value]) => ({ id, value }));
      const weakLabel = weakLabels.get(token);
      const isWeakSelected = weakSelected.has(token);
      const boxValue = box.get();
      return <main>
        <button id="map" onClick={() => labels.set(2, "b")}>map</button>
        <button id="set" onClick={() => selected.add("y")}>set</button>
        <button id="object" onClick={() => record.second = 2}>object</button>
        <button id="weak-map" onClick={() =>
          weakLabels.set(token, "weak-b")
        }>weak map</button>
        <button id="weak-set" onClick={() =>
          weakSelected.delete(token)
        }>weak set</button>
        <button id="box" onClick={() => box.set("box-b")}>box</button>
        <output id="weak-label">{weakLabel}</output>
        <output id="weak-selected">{isWeakSelected ? "yes" : "no"}</output>
        <output id="box-value">{boxValue}</output>
        <div id="maps">{mapRows.map(row =>
          <span key={row.id}>{row.title}</span>
        )}</div>
        <div id="sets">{setRows.map(row =>
          <span key={row.id}>{row.value}</span>
        )}</div>
        <div id="objects">{objectRows.map(row =>
          <span key={row.id}>{row.value}</span>
        )}</div>
      </main>;
    }
  `,
  'r23-local-async': `
    export function App() {
      let loading = false;
      let todos = [{ id: 1, title: "a" }];
      async function fetchRemote() {
        loading = true;
        await Promise.resolve();
        todos = [{ id: 2, title: "remote" }];
        loading = false;
      }
      return <main>
        <button id="load" onClick={fetchRemote}>
          {loading ? "loading" : "ready"}
        </button>
        <div>{todos.map(todo =>
          <span key={todo.id}>{todo.title}</span>
        )}</div>
      </main>;
    }
  `,
  'r23-module-async': `
    let loading = false;
    let todos = [{ id: 1, title: "a" }];
    async function fetchRemote() {
      loading = true;
      await Promise.resolve();
      todos = [{ id: 2, title: "remote" }];
      loading = false;
    }
    export function App() {
      return <main>
        <button id="load" onClick={() => fetchRemote()}>
          {loading ? "loading" : "ready"}
        </button>
        <div>{todos.map(todo =>
          <span key={todo.id}>{todo.title}</span>
        )}</div>
      </main>;
    }
  `,
};

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

function texts(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map(
    (element) => element.textContent ?? '',
  );
}

describe('R23 - stable local state', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, source] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(source, { runtimePath: '@memoized-dom/runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((commit) => commit());
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('reconciles a local array and propagates row writes to owner derivations', async () => {
    const { App } = await importFixture('./fixtures/out/r23-array-row.compiled.ts');
    document.body.appendChild(App('App', null));

    expect(texts('.row')).toEqual(['a']);
    document.querySelector<HTMLButtonElement>('#add')!.click();
    expect(texts('.row')).toEqual(['a', 'b']);
    expect(document.querySelector('#titles')!.textContent).toBe('a,b');

    document.querySelector<HTMLButtonElement>('.row')!.click();
    expect(texts('.row')).toEqual(['a!', 'b']);
    expect(document.querySelector('#titles')!.textContent).toBe('a!,b');
  });

  it('maps a static path on a local object root', async () => {
    const { App } = await importFixture('./fixtures/out/r23-object-path.compiled.ts');
    document.body.appendChild(App('App', null));
    document.querySelector<HTMLButtonElement>('#add')!.click();
    expect(texts('span')).toEqual(['a', 'b']);
  });

  it('recomputes ordered views derived from Map, Set, and object state', async () => {
    const { App } = await importFixture('./fixtures/out/r23-collections.compiled.ts');
    document.body.appendChild(App('App', null));

    document.querySelector<HTMLButtonElement>('#map')!.click();
    document.querySelector<HTMLButtonElement>('#set')!.click();
    document.querySelector<HTMLButtonElement>('#object')!.click();
    document.querySelector<HTMLButtonElement>('#weak-map')!.click();
    document.querySelector<HTMLButtonElement>('#weak-set')!.click();
    document.querySelector<HTMLButtonElement>('#box')!.click();
    expect(texts('#maps span')).toEqual(['a', 'b']);
    expect(texts('#sets span')).toEqual(['x', 'y']);
    expect(texts('#objects span')).toEqual(['1', '2']);
    expect(document.querySelector('#weak-label')!.textContent).toBe('weak-b');
    expect(document.querySelector('#weak-selected')!.textContent).toBe('no');
    expect(document.querySelector('#box-value')!.textContent).toBe('box-b');
  });

  it('resolves a direct local async declaration at both execution boundaries', async () => {
    const { App } = await importFixture('./fixtures/out/r23-local-async.compiled.ts');
    document.body.appendChild(App('App', null));
    const button = document.querySelector<HTMLButtonElement>('#load')!;

    button.click();
    expect(button.textContent).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(button.textContent).toBe('ready');
    expect(texts('span')).toEqual(['remote']);
  });

  it('commits module helper writes after its async continuation', async () => {
    const { App } = await importFixture('./fixtures/out/r23-module-async.compiled.ts');
    document.body.appendChild(App('App', null));
    const button = document.querySelector<HTMLButtonElement>('#load')!;

    button.click();
    expect(button.textContent).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(button.textContent).toBe('ready');
    expect(texts('span')).toEqual(['remote']);
  });
});

/**
 * M5.5 — retained-row resync + member-path list sources.
 *
 * Two correctness gaps closed, both exposed by external-mutation scenarios
 * (the dom-reconciler-bench integration):
 *
 * 1. Rows read their item (a factory param), not module state — so mutating
 *    a retained row's item fields was invisible to the access table. The
 *    list region now re-runs a reused row's guarded update() on every
 *    reconcile: DOM is touched only when the data actually changed.
 *
 * 2. List sources may be a static store path: {store.todos.map(…)}. The
 *    read/write key is the dotted path ('store.todos'), the region suffix
 *    is the last segment ('todos').
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler/compile';
import {
  unregister,
  setScheduler,
  resetScheduler,
  _internals,
} from '../src/kernel';
import { resetAccessTable } from '../src/access';
import { commitWrites } from '../src/events';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('M5.5 — member-path list sources, code generation', () => {
  it('store.todos.map compiles to a region keyed on the dotted path', () => {
    const code = compile(
      `const store = { todos: [{ id: 1, title: 'a' }] };\nfunction C() { return <ul>{store.todos.map((t) => <li key={t.id}>{t.title}</li>)}</ul>; }`,
    );
    expect(code).toContain('MD.createListRegion(');
    expect(code).toContain('region0.reconcile(store.todos)');
    expect(code).toContain('id + "/todos"'); // suffix = last segment
  });

  it('store-path mutator writes route to the list owner', () => {
    const code = compile(
      `const store = { todos: [{ id: 1 }] };\nfunction C() { return <div><ul>{store.todos.map((t) => <li key={t.id}>{t.id}</li>)}</ul><button onClick={() => { store.todos.push({ id: 2 }); }}>add</button></div>; }`,
    );
    expect(code).toContain('MD.markDirty(id)'); // read only by C → local
  });

  it('inline-row entries carry their update closure', () => {
    const code = compile(
      `const items = [{ id: 1 }];\nfunction C() { return <ul>{items.map((i) => <li key={i.id}>{i.id}</li>)}</ul>; }`,
    );
    // entry object: { nodes: [li0], entities: [rowId], update }
    expect(code).toMatch(/entities: \[rowId\],\s*update/);
  });

  it('non-store member sources are rejected', () => {
    expect(() =>
      compile(
        `let items = [1];\nfunction C() { return <ul>{foo.items.map((i) => <li>{i}</li>)}</ul>; }`,
      ),
    ).toThrowError(/module-level array state/);
    // dynamic path on a store
    expect(() =>
      compile(
        `const store = { items: [1] };\nlet k = 'items';\nfunction C() { return <ul>{store[k].map((i) => <li>{i}</li>)}</ul>; }`,
      ),
    ).toThrowError(/module-level array state/);
  });
});

const SOURCES: Record<string, string> = {
  'm55-storelist': `export const store = { counter: 0, todos: [{ id: 1, title: 'one', completed: false }, { id: 2, title: 'two', completed: false }] };\nexport function C() { return <div><h1>{store.counter}</h1><ul>{store.todos.map((t) => <li key={t.id} class={t.completed ? 'done' : ''}>{t.title}</li>)}</ul></div>; }`,
  'm55-storelist2': `export const store = { counter: 0, todos: [{ id: 1, title: 'one', completed: false }, { id: 2, title: 'two', completed: false }] };\nexport function C() { return <div><h1>{store.counter}</h1><ul>{store.todos.map((t) => <li key={t.id} class={t.completed ? 'done' : ''}>{t.title}</li>)}</ul></div>; }`,
};

describe('M5.5 — external mutations resync retained rows', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, src] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(src, { runtimePath: '../out-runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('rename, toggle and counter all sync through commitWrites', async () => {
    const mod = await importCompiled('m55-storelist');
    document.body.appendChild(mod.C('App', null));

    const lis = () => document.querySelectorAll('li');
    expect(lis()[0]!.textContent).toBe('one');

    // External mutation: invisible to the framework (happens outside any
    // handler) — exactly the benchmark's contract. commitWrites is the
    // public programmatic invalidation entry point (M4).
    mod.store.todos[0].title = 'renamed';
    mod.store.todos[1].completed = true;
    mod.store.counter = 42;
    commitWrites(['store.counter', 'store.todos']);

    expect(lis()[0]!.textContent).toBe('renamed'); // row resync (M5.5)
    expect(lis()[1]!.className).toBe('done');
    expect(document.querySelector('h1')!.textContent).toBe('42');
    expect(lis()).toHaveLength(2); // no rows recreated
  });

  it('resync touches DOM only when data changed (guarded setters)', async () => {
    // NOTE: separate fixture — the compiled module registers its access
    // table at import time, and module imports are cached across tests.
    const mod = await importCompiled('m55-storelist2');
    document.body.appendChild(mod.C('App', null));

    const firstLi = document.querySelector('li')!;
    const firstText = firstLi.firstChild;

    // no-op external commit: same data, reconcile runs, zero DOM mutations
    commitWrites(['store.counter', 'store.todos']);
    expect(document.querySelector('li')).toBe(firstLi);
    expect(document.querySelector('li')!.firstChild).toBe(firstText);

    // splice one out and push one in — structure still reconciles by key
    mod.store.todos.splice(0, 1);
    mod.store.todos.push({ id: 3, title: 'three', completed: false });
    commitWrites(['store.todos']);

    const lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(2);
    expect(lis[0]!.textContent).toBe('two');
    expect(lis[1]!.textContent).toBe('three');
  });
});

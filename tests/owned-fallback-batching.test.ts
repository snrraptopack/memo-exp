import { afterEach, beforeAll, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import {
  _internals, markDirty, markDirtySubtree, register, resetScheduler,
  setScheduler, undirty, unregister, type DirtyReasons,
} from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/owned-fallback-batching');
const globals = globalThis as typeof globalThis & {
  makeOwnedItems?: () => Array<{ id: number; label: string }>;
  recordOwnedRow?: (id: number) => void;
  ownedHidden?: number;
};
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component']) {
    const source = `
      function trace(id, value) { globalThis.recordOwnedRow(id); return value; }
      ${kind === 'component' ? `function Row({item}) {
        return <li data-id={item.id}>{trace(item.id, item.label)}</li>;
      }` : ''}
      export function App() {
        let items = globalThis.makeOwnedItems();
        return <main>
          <button onClick={() => { const first = items[0]; items[0] = items[1]; items[1] = first; }}>swap</button>
          <output>{globalThis.ownedHidden}</output>
          <ul>{items.map(item => ${kind === 'component'
            ? '<Row key={item.id} item={item}/>'
            : '<li key={item.id} data-id={item.id}>{trace(item.id, item.label)}</li>'})}</ul>
        </main>;
      }
    `;
    writeFileSync(join(directory, `${kind}.ts`), compile(source));
  }
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  document.body.innerHTML = '';
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler();
  delete globals.makeOwnedItems; delete globals.recordOwnedRow; delete globals.ownedHidden;
});

it.each([false, true])('publishes owner and subtree once, preserving broad reasons (deferred=%s)', deferred => {
  const renders: Array<[string, DirtyReasons]> = [];
  let schedules = 0;
  let flush!: () => void;
  setScheduler(fn => { schedules++; if (deferred) flush = fn; else fn(); });
  register({ id: 'App', parent: null, render: reasons => {
    renders.push(['App', reasons ?? null]);
    undirty('App/Row');
    markDirty('App/Badge', 7);
  } });
  register({ id: 'App/Row', parent: 'App', render: () => { throw Error('duplicate row replay'); } });
  register({ id: 'App/Badge', parent: 'App', render: reasons => renders.push(['badge', reasons ?? null]) });
  markDirtySubtree('App', 'App', [1, 2]);
  if (deferred) { expect(renders).toEqual([]); flush(); }
  expect(renders).toEqual([['App', null], ['badge', null]]);
  expect(schedules).toBe(1);
});

it('preserves an owner outside the fallback subtree and its exact reasons', () => {
  const renders: Array<[string, DirtyReasons]> = [];
  let schedules = 0;
  setScheduler(fn => { schedules++; fn(); });
  for (const id of ['App', 'Other']) {
    register({ id, parent: null, render: reason => renders.push([id, reason ?? null]) });
  }
  markDirtySubtree('App', 'Other', 9);
  expect(renders).toEqual([['Other', 9], ['App', null]]);
  expect(schedules).toBe(1);
  renders.length = 0;
  markDirtySubtree('Missing', 'Other', 3);
  expect(renders).toEqual([['Other', 3]]);
  markDirtySubtree('Missing', 'AlsoMissing', 3);
  expect(schedules).toBe(2);
});

for (const kind of ['inline', 'component']) {
  for (const proxy of [false, true]) {
    it.each([false, true])(`${kind} rows replay once and retain identity (proxy=${proxy}, deferred=%s)`, async deferred => {
      const replayed: number[] = [];
      let traps = 0;
      globals.ownedHidden = 0;
      globals.recordOwnedRow = id => replayed.push(id);
      globals.makeOwnedItems = () => {
        const items = [1, 2, 3].map(id => ({ id, get label() { return `row ${id}:${globals.ownedHidden}`; } }));
        return proxy ? new Proxy(items, { set(target, key, value) {
          traps++; globals.ownedHidden!++;
          return Reflect.set(target, key, value);
        } }) : items;
      };
      let schedules = 0;
      let flush!: () => void;
      setScheduler(fn => { schedules++; if (deferred) flush = fn; else fn(); });
      const specifier = `./fixtures/out/owned-fallback-batching/${kind}.ts`;
      const { App } = await import(specifier);
      document.body.append(App('App', null));
      const nodes = Array.from(document.querySelectorAll('li'));
      replayed.length = 0; schedules = 0;
      for (let operation = 1; operation <= 2; operation++) {
        (document.querySelector('button') as HTMLButtonElement).click();
        if (deferred) { expect(replayed).toEqual([]); flush(); }
        expect(replayed).toEqual(operation === 1 ? [2, 1, 3] : [1, 2, 3]);
        const expected = operation === 1 ? [nodes[1], nodes[0], nodes[2]] : nodes;
        document.querySelectorAll('li').forEach((node, index) => expect(node).toBe(expected[index]));
        const hidden = proxy ? operation * 2 : 0;
        expect(document.querySelector('output')!.textContent).toBe(String(hidden));
        expect(document.querySelectorAll('li')[2].textContent).toBe(`row 3:${hidden}`);
        expect(traps).toBe(hidden);
        expect(schedules).toBe(operation);
        replayed.length = 0;
      }
    });
  }
}

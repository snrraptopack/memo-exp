import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/list-journal-fallback');
const probe = globalThis as typeof globalThis & {
  makeJournalItems?: () => Array<{ id: number; label: string }>;
  journalRenders?: number[];
  journalHidden?: number;
  journalEnabled?: boolean;
};
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const owned of [false, true]) {
    writeFileSync(join(directory, `hidden-${owned}.ts`), compile(`
      ${owned ? '' : "let items = [{id: 1, label: 'one'}, {id: 2, label: 'two'}]; function label(value) { return value + ':' + items[0].label; }"}
      export function App() {
        ${owned ? "let items = [{id: 1, label: 'one'}, {id: 2, label: 'two'}]; const label = value => value + ':' + items[0].label;" : ''}
        return <main><button onClick={() => { items[0].label = 'changed'; }}>update</button>
          <ul>{items.map(item => <li key={item.id}>{label(item.label)}</li>)}</ul>
        </main>;
      }
    `));
  }
  for (const kind of ['inline', 'component']) {
    writeFileSync(join(directory, `${kind}.ts`), compile(`
      ${kind === 'component' ? 'function Row({item}) { return <li>{item.label}</li>; }' : ''}
      function Aside() { return <output>{globalThis.journalHidden}</output>; }
      export function App() {
        let items = globalThis.makeJournalItems();
        return <main><Aside/><button onClick={() => { items[0].label += '!'; }}>update</button>
          <ul>{items.map(item => ${kind === 'component' ? '<Row key={item.id} item={item}/>' : '<li key={item.id}>{item.label}</li>'})}</ul>
        </main>;
      }
    `));
    writeFileSync(join(directory, `${kind}-module.ts`), compile(`
      let items = [{id: 1, label: 'one'}, {id: 2, label: 'two'}];
      function trace(id, value) { globalThis.journalRenders.push(id); return value; }
      ${kind === 'component' ? 'function Row({item}) { return <li>{trace(item.id, item.label)}</li>; }' : ''}
      export function App() {
        return <main><button onClick={() => { if (globalThis.journalEnabled) items[0].label += '!'; }}>update</button>
          <ul>{items.map(item => ${kind === 'component' ? '<Row key={item.id} item={item}/>' : '<li key={item.id}>{trace(item.id, item.label)}</li>'})}</ul>
        </main>;
      }
    `));
    writeFileSync(join(directory, `${kind}-plain.ts`), compile(`
      function trace(id, value) { globalThis.journalRenders.push(id); return value; }
      ${kind === 'component' ? 'function Row({item}) { return <li>{trace(item.id, item.label)}</li>; }' : ''}
      export function App() {
        let items = [{id: 1, label: 'one'}, {id: 2, label: 'two'}];
        return <main><button onClick={() => { items[0].label += '!'; }}>update</button>
          <ul>{items.map(item => ${kind === 'component' ? '<Row key={item.id} item={item}/>' : '<li key={item.id}>{trace(item.id, item.label)}</li>'})}</ul>
        </main>;
      }
    `));
  }
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  document.body.innerHTML = '';
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); delete probe.makeJournalItems; delete probe.journalRenders; delete probe.journalHidden;
  delete probe.journalEnabled;
});

for (const kind of ['inline', 'component']) {
  it.each([false, true])(`${kind}: targets only executed conditional module writes (deferred=%s)`, async deferred => {
    const scheduled: Array<() => void> = [];
    setScheduler(fn => { if (deferred) scheduled.push(fn); else fn(); });
    const renders: number[] = [];
    probe.journalRenders = renders; probe.journalEnabled = false;
    const specifier = `./fixtures/out/list-journal-fallback/${kind}-module.ts`;
    const { App } = await import(specifier);
    document.body.append(App('App', null));
    const before = document.querySelectorAll('li')[0].textContent;
    renders.length = 0;
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(scheduled).toHaveLength(0); expect(renders).toEqual([]);
    probe.journalEnabled = true;
    document.querySelector<HTMLButtonElement>('button')!.click();
    while (scheduled.length) scheduled.shift()!();
    expect(renders).toEqual([1]);
    expect(document.querySelectorAll('li')[0].textContent).toBe(`${before}!`);
    expect(document.querySelectorAll('li')[1].textContent).toBe('two');
  });
  it(`${kind}: keeps targeted refresh for closed plain records`, async () => {
    setScheduler(fn => fn());
    const renders: number[] = [];
    probe.journalRenders = renders;
    const specifier = `./fixtures/out/list-journal-fallback/${kind}-plain.ts`;
    const { App } = await import(specifier);
    document.body.append(App('App', null));
    renders.length = 0;
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(renders).toEqual([1]);
    expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['one!', 'two']);
  });
  it.each([false, true])(`${kind}: preserves opaque setter effects and receiver evaluation (deferred=%s)`, async deferred => {
    let receiverReads = 0;
    let readsAtWrite = 0;
    probe.journalHidden = 0;
    const second = { id: 2, label: 'two' };
    const first = { id: 1, label: 'one' };
    const receiver = new Proxy(first, { set(target, property, value) {
      readsAtWrite = receiverReads;
      probe.journalHidden!++;
      second.label = 'changed by setter';
      return Reflect.set(target, property, value);
    } });
    probe.makeJournalItems = () => new Proxy([receiver, second], { get(target, property, receiver) {
      if (property === '0') receiverReads++;
      return Reflect.get(target, property, receiver);
    } });
    const scheduled: Array<() => void> = [];
    setScheduler(fn => { if (deferred) scheduled.push(fn); else fn(); });
    const specifier = `./fixtures/out/list-journal-fallback/${kind}.ts`;
    const { App } = await import(specifier);
    document.body.append(App('App', null));
    const nodes = [...document.querySelectorAll('li')];
    receiverReads = 0;
    document.querySelector<HTMLButtonElement>('button')!.click();
    while (scheduled.length) scheduled.shift()!();
    expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['one!', 'changed by setter']);
    expect(readsAtWrite).toBe(1);
    expect(document.querySelector('output')!.textContent).toBe('1');
    document.querySelectorAll('li').forEach((node, index) => expect(node).toBe(nodes[index]));
  });
}

it.each([false, true])('replays cross-row helper reads (owned=%s)', async owned => {
  setScheduler(fn => fn());
  const specifier = `./fixtures/out/list-journal-fallback/hidden-${owned}.ts`;
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const nodes = [...document.querySelectorAll('li')];
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['changed:changed', 'two:changed']);
  document.querySelectorAll('li').forEach((node, index) => expect(node).toBe(nodes[index]));
});

import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { createListRegion } from '@memoized-dom/runtime';

const directory = join(import.meta.dirname, 'fixtures/out/mixed-list-selection');
const fixtures = new Map<string, string>();
const rows = `[{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }]`;
for (const component of [false, true]) {
  fixtures.set(component ? 'component' : 'inline', `
    let items = ${rows};
    function trace(id, value) { globalThis.recordRow(id); return value; }
    function Row({ item, active, select }) {
      return <li data-id={item.id} class={trace(item.id, active) ? 'selected' : ''}
        onClick={() => select(item.id)}>{item.label}</li>;
    }
    export function App() {
      let selected = 0;
      const select = id => { selected = id; };
      return <main>
        <button id="reverse" onClick={() => { items.reverse(); }}>reverse</button>
        <button id="remove" onClick={() => { items = items.filter(item => item.id !== selected); }}>remove</button>
        <button id="append" onClick={() => { items = [...items, { id: 4, label: 'four' }]; }}>append</button>
        <button id="combined" onClick={() => { items = ${rows}; selected = 3; }}>combined</button>
        <button id="rename" onClick={() => { items[0].label = 'renamed'; }}>rename</button>
        <ul>{items.map(item => ${component
          ? '<Row key={item.id} item={item} active={selected === item.id} select={select} />'
          : `<li key={item.id} data-id={item.id}
              class={trace(item.id, selected === item.id) ? 'selected' : ''}
              onClick={() => { selected = item.id; }}>{item.label}</li>`
        })}</ul>
      </main>;
    }
  `);
}
fixtures.set('hidden-read', `
  function trace(id, value) { globalThis.recordRow(id); return value; }
  export function App() {
    let selected = 0;
    let items = [
      { id: 1, get label() { return selected; } },
      { id: 2, get label() { return selected; } },
      { id: 3, get label() { return selected; } },
    ];
    return <main><button onClick={() => { selected = 2; }}>select</button>
      <ul>{items.map(item => <li key={item.id}
        class={trace(item.id, selected === item.id) ? 'selected' : ''}>{item.label}</li>)}</ul>
    </main>;
  }
`);
fixtures.set('fixed-module', `
  let items = ${rows};
  function trace(id, value) { globalThis.recordRow(id); return value; }
  export function App() {
    let selected = 0;
    return <main><button onClick={() => { items[0].label = 'changed'; }}>rename</button>
      <ul>{items.map(item => <li key={item.id} data-id={item.id}
        onClick={() => { selected = item.id; }}
        class={trace(item.id, selected === item.id) ? 'selected' : ''}>{item.label}</li>)}</ul>
    </main>;
  }
`);
fixtures.set('loose-equality', `
  export function App() {
    let items = [{ id: 1 }, { id: '1' }];
    let selected = 0;
    return <main><button onClick={() => { selected = 1; }}>select</button>
      <ul>{items.map(item => <li key={item.id} class={selected == item.id ? 'selected' : ''}>row</li>)}</ul>
    </main>;
  }
`);
fixtures.set('key-expression', `
  export function App() {
    let items = ${rows};
    let selected = 0;
    const key = item => item.id + selected;
    return <main><button onClick={() => { selected = 1; }}>select</button>
      <ul>{items.map(item => <li key={key(item)} class={selected === key(item) ? 'selected' : ''}>{item.label}</li>)}</ul>
    </main>;
  }
`);

const replayed: number[] = [];
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const [name, source] of fixtures) {
    const id = `./${name}.tsx`;
    writeFileSync(join(directory, `${name}.ts`), compileModules({ [id]: source }, { runtimePath: '@memoized-dom/runtime' })[id]!);
  }
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(fn => fn());
  document.body.innerHTML = '';
  replayed.length = 0;
  vi.stubGlobal('recordRow', (id: number) => replayed.push(id));
});
afterEach(() => { resetScheduler(); vi.unstubAllGlobals(); });

async function mount(name: string) {
  const specifier = `./fixtures/out/mixed-list-selection/${name}.ts`;
  const { App } = await import(/* @vite-ignore */ specifier);
  document.body.append(App('App', null));
  replayed.length = 0;
}
function click(selector: string) { document.querySelector<HTMLButtonElement>(selector)!.click(); }
function ids() { return [...document.querySelectorAll<HTMLElement>('li')].map(row => Number(row.dataset.id)); }

for (const name of ['inline', 'component']) {
  it(`${name}: refreshes two keys and preserves retained rows through module writes`, async () => {
    await mount(name);
    const retained = document.querySelector('[data-id="1"]');
    click('[data-id="2"]');
    expect(replayed).toEqual([2]);
    replayed.length = 0;
    click('[data-id="1"]');
    expect(replayed).toEqual([2, 1]);
    expect(document.querySelectorAll('li.selected')).toHaveLength(1);
    click('#reverse');
    expect(ids()).toEqual([3, 2, 1]);
    expect(document.querySelector('[data-id="1"]')).toBe(retained);
    click('#remove');
    expect(ids()).toEqual([3, 2]);
    expect(document.querySelectorAll('li.selected')).toHaveLength(0);
    click('#append');
    expect(ids()).toEqual([3, 2, 4]);
    replayed.length = 0;
    click('[data-id="4"]');
    expect(replayed).toEqual([4]);
    expect(document.querySelector('[data-id="4"]')?.className).toBe('selected');
    click('#combined');
    expect(ids()).toEqual([1, 2, 3]);
    expect(document.querySelector('[data-id="3"]')?.className).toBe('selected');
    expect(document.querySelectorAll('li.selected')).toHaveLength(1);
    replayed.length = 0;
    click('#rename');
    expect(document.querySelector('[data-id="1"]')?.textContent).toBe('renamed');
    // Replacements and filter callbacks prevent a fixed-position proof here.
    expect(replayed).toEqual([1, 2, 3]);
  });
}
it('keeps full replay for getters with hidden selection reads', async () => {
  await mount('hidden-read');
  click('button');
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['2', '2', '2']);
  expect(replayed).toEqual([1, 2, 3]);
});
it('keeps full replay when loose equality matches differently typed keys', async () => {
  await mount('loose-equality');
  click('button');
  expect(document.querySelectorAll('li.selected')).toHaveLength(2);
});
it('reconciles when the key expression reads selection', async () => {
  await mount('key-expression');
  const previous = document.querySelector('li');
  click('button');
  expect(document.querySelector('li')).not.toBe(previous);
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['one', 'two', 'three']);
});
it('preserves proven module item targeting and merges module/selection causes safely', async () => {
  await mount('fixed-module');
  click('button');
  expect(replayed).toEqual([1]);
  replayed.length = 0;
  const scheduled: Array<() => void> = [];
  setScheduler(fn => scheduled.push(fn));
  click('[data-id="2"]');
  click('button');
  while (scheduled.length) scheduled.shift()!();
  expect(replayed).toEqual([1, 2, 3]);
  expect(document.querySelector('[data-id="1"]')?.textContent).toBe('changed');
  expect(document.querySelector('[data-id="2"]')?.className).toBe('selected');
});
it('validates keys for unchanged item references without evaluating keys twice', () => {
  const items = [{ id: 1 }, { id: 2 }];
  let offset = 0;
  let evaluations = 0;
  const host = document.createElement('ul');
  const region = createListRegion(host, 'dynamic-keys', item => {
    const node = document.createElement('li');
    node.textContent = String(item.id);
    return { nodes: node, entities: [] };
  }, item => { evaluations++; return item.id + offset; }, false);
  region.reconcile(items);
  const first = host.querySelector('li');
  evaluations = 0;
  offset = 10;
  region.reconcile(items);
  expect(host.querySelector('li')).not.toBe(first);
  expect(evaluations).toBe(2);
  region.dispose();
});

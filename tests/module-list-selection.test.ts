import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/module-list-selection');
const fixtures = new Map<string, string>();
const rows = `[{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }]`;
for (const ownedData of [false, true]) {
  for (const kind of ['inline', 'component', 'props']) {
    fixtures.set(`${ownedData ? 'owned' : 'module'}-${kind}`, `
      let selected = null;
      ${ownedData ? '' : `let items = ${rows};`}
      function trace(id, value) { globalThis.recordModuleRow(id); return value; }
      ${kind === 'inline' ? '' : `function Row(props) {
        return <li data-id={props.item.id}
          class={trace(props.item.id, ${kind === 'props' ? 'props.active' : 'selected === props.item.id'}) ? 'selected' : ''}
          onClick={() => { selected = props.item.id; }}>{props.item.label}</li>;
      }`}
      export function App() {
        ${ownedData ? `let items = ${rows};` : ''}
        return <main>
          <button id="reverse" onClick={() => { items = [...items].reverse(); }}>reverse</button>
          <button id="remove" onClick={() => { items = items.filter(item => item.id !== selected); }}>remove</button>
          <button id="append" onClick={() => { items = [...items, { id: 4, label: 'four' }]; }}>append</button>
          <button id="combined" onClick={() => { items = ${rows}; selected = 3; }}>combined</button>
          <button id="reset" onClick={() => { selected = null; }}>reset</button>
          <ul>{items.map(item => ${kind === 'inline'
            ? `<li key={item.id} data-id={item.id} class={trace(item.id, selected === item.id) ? 'selected' : ''}
                onClick={() => { selected = item.id; }}>{item.label}</li>`
            : `<Row key={item.id} item={item} ${kind === 'props' ? 'active={selected === item.id}' : ''}/>`
          })}</ul>
        </main>;
      }
    `);
  }
}
fixtures.set('hidden', `
  let selected = 0;
  let items = [{ id: 1, get label() { return selected; } }, { id: 2, get label() { return selected; } }];
  export function App() { return <main><button onClick={() => { selected = 2; }}>select</button>
    <ul>{items.map(item => <li key={item.id} class={selected === item.id ? 'selected' : ''}>{item.label}</li>)}</ul>
  </main>; }
`);
fixtures.set('general', `
  let selected = 0; let items = ${rows};
  export function App() { return <main><button onClick={() => { selected = 2; }}>select</button>
    <ul>{items.map(item => <li key={item.id} class={selected === item.id ? 'selected' : ''}>{selected}:{item.label}</li>)}</ul>
  </main>; }
`);
fixtures.set('two-lists', `
  let selected = null;
  function trace(id, value) { globalThis.recordModuleRow(id); return value; }
  function List() {
    let items = ${rows};
    return <ul>{items.map(item => <li key={item.id} data-id={item.id}
      class={trace(item.id, selected === item.id) ? 'selected' : ''}
      onClick={() => { selected = item.id; }}>{item.label}</li>)}</ul>;
  }
  export function App() { return <main><List/><List/></main>; }
`);
for (const helper of [false, true]) fixtures.set(helper ? 'helper-key' : 'dynamic-key', `
  let selected = 0; let items = ${rows};
  ${helper ? 'function rowKey(item) { return item.id + selected; }' : ''}
  export function App() { return <main><button onClick={() => { selected = 1; }}>select</button>
    <ul>{items.map(item => <li key={${helper ? 'rowKey(item)' : 'item.id + selected'}}
      class={selected === item.id ? 'selected' : ''}>{item.label}</li>)}</ul></main>; }
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
  setScheduler(fn => fn()); document.body.innerHTML = ''; replayed.length = 0;
  vi.stubGlobal('recordModuleRow', (id: number) => replayed.push(id));
});
afterEach(() => { resetScheduler(); vi.unstubAllGlobals(); });
async function mount(name: string) {
  const specifier = `./fixtures/out/module-list-selection/${name}.ts`;
  const { App } = await import(/* @vite-ignore */ specifier);
  document.body.append(App('App', null)); replayed.length = 0;
}
function click(selector: string) { document.querySelector<HTMLButtonElement>(selector)!.click(); }
function ids() { return [...document.querySelectorAll<HTMLElement>('li')].map(row => Number(row.dataset.id)); }
for (const name of fixtures.keys()) {
  if (!/^(module|owned)-/.test(name)) continue;
  it(`${name}: selects two keys, preserves reorder identity and handles mixed batches`, async () => {
    await mount(name);
    click('[data-id="2"]'); expect(replayed).toEqual([2]);
    replayed.length = 0;
    click('[data-id="1"]'); expect(replayed).toEqual([2, 1]);
    const retained = document.querySelector('[data-id="1"]');
    const scheduled: Array<() => void> = [];
    setScheduler(fn => scheduled.push(fn));
    click('[data-id="3"]'); click('#reverse');
    while (scheduled.length) scheduled.shift()!();
    expect(ids()).toEqual([3, 2, 1]);
    expect(document.querySelector('[data-id="1"]')).toBe(retained);
    expect(document.querySelector('[data-id="3"]')?.className).toBe('selected');
    expect(document.querySelectorAll('li.selected')).toHaveLength(1);
    setScheduler(fn => fn());
    click('#remove'); click('#append');
    expect(ids()).toEqual([2, 1, 4]);
    replayed.length = 0;
    click('[data-id="4"]'); expect(replayed).toEqual([4]);
    click('#combined');
    expect(ids()).toEqual([1, 2, 3]);
    expect(document.querySelector('[data-id="3"]')?.className).toBe('selected');
    expect(document.querySelectorAll('li.selected')).toHaveLength(1);
    replayed.length = 0;
    click('#reset'); expect(replayed).toEqual([3]);
    expect(document.querySelectorAll('li.selected')).toHaveLength(0);
    unregister('App');
    expect([..._internals().registry.keys()].filter(id => id.startsWith('App'))).toEqual([]);
  });
}
it('retains full replay for hidden getter dependencies', async () => {
  await mount('hidden'); click('button');
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['2', '2']);
});
it('retains full replay for general visual selection reads', async () => {
  await mount('general'); click('button');
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['2:one', '2:two', '2:three']);
});
it('updates each list instance with its own cached previous key', async () => {
  await mount('two-lists');
  click('[data-id="2"]'); expect(replayed).toEqual([2, 2]);
  replayed.length = 0;
  click('[data-id="1"]'); expect(replayed).toEqual([2, 1, 2, 1]);
  expect(document.querySelectorAll('li.selected')).toHaveLength(2);
});
it.each(['dynamic-key', 'helper-key'])('reconciles module-dependent keys: %s', async name => {
  await mount(name);
  const previous = document.querySelector('li');
  click('button');
  expect(document.querySelector('li')).not.toBe(previous);
  expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['one', 'two', 'three']);
});
it.each([
  'export let selected = null;',
  'let selected = null; function readSelected() { return selected; }',
])('keeps exported bindings and hidden helper reads conservative: %s', declaration => {
  const code = compileModules({ './app.tsx': `${declaration}
    let items = [{ id: 1 }];
    export function App() { return <main><button onClick={() => { selected = 1; }}>select</button>
      <ul>{items.map(item => <li key={item.id} class={selected === item.id ? 'selected' : ''}/>)}</ul></main>; }
  ` })['./app.tsx']!;
  expect(code).not.toContain('/$selection');
});
it('keeps a broad owner reader if another use of the same row lacks a key proof', () => {
  const code = compileModules({ './app.tsx': `let selected = null;
    function Row({item}) { return <li class={selected === item.id ? 'selected' : ''}>{item.id}</li>; }
    export function App() { let items = [{id:1}];
      return <main><button onClick={() => { selected = 1; }}>select</button><ul>{items.map(item => <Row key={item.id} item={item}/>)}</ul>
        <ol>{items.map(item => <Row key={item.id + 1} item={item}/>)}</ol></main>;
    }
  ` })['./app.tsx']!;
  expect(code).toMatch(/"\.\/app.tsx#selected": \["App", "App\/items\/\$selection"\]/);
});
it('does not confuse same-spelled component state with module state', () => {
  const code = compileModules({ './app.tsx': `let selected = null;
    export function setGlobal() { selected = 1; }
    export function App() { let items = [{id:1}]; let selected = 0;
      return <main><button onClick={() => { selected = 1; }}>select</button><ul>{items.map(item => <li key={item.id} class={selected === item.id ? 'selected' : ''}/>)}</ul></main>;
    }
  ` })['./app.tsx']!;
  expect(code).not.toContain('/$selection');
  expect(code).toContain('.refreshKey(');
});

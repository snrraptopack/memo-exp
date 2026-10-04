import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister, unregisterSubtree } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/lightweight-inline-rows');
const rows = `[{id: 1, label: 'one'}, {id: 2, label: 'two'}, {id: 3, label: 'three'}]`;
const source = (owned: boolean) => `
  ${owned ? '' : `let items = ${rows}; let selected = null;`}
  export function App() {
    ${owned ? `let items = ${rows}; let selected = null;` : ''}
    return <main>
      <button id="reverse" onClick={() => { items = [...items].reverse(); }}>reverse</button>
      <button id="key" onClick={() => { items[0].id += 10; }}>key</button>
      <button id="remove" onClick={() => { items = items.filter(item => item.id !== selected); }}>remove</button>
      <button id="clear" onClick={() => { items = []; }}>clear</button>
      <ul>{items.map((item, index) => <li key={item.id} data-id={item.id}
        class={selected === item.id ? 'selected' : ''}
        onClick={() => { selected = item.id; }} onKeyDown={() => globalThis.advanceInlineTick()}>
        <span>{item.label}:{index}:{globalThis.inlineTick}</span>
        <button data-role="rename" onClick={() => { item.label += '!'; }}>rename</button>
      </li>)}</ul>
    </main>;
  }
`;
const globals = globalThis as typeof globalThis & { inlineTick?: number; advanceInlineTick?: () => void };
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const owned of [false, true]) {
    const kind = owned ? 'owned' : 'module';
    for (const suffix of ['', '-events']) writeFileSync(join(directory, `${kind}${suffix}.ts`), compile(source(owned)));
  }
  writeFileSync(join(directory, 'external.ts'), compile(`let suffix = '!'; let items = ${rows};
    export function App() { return <main><button id="suffix" onClick={() => suffix = '?'}>suffix</button>
      <ul>{items.map(item => <li key={item.id}>{item.label}{suffix}</li>)}</ul></main>; }`));
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(fn => fn()); document.body.innerHTML = ''; globals.inlineTick = 0;
  globals.advanceInlineTick = () => { globals.inlineTick!++; };
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id)); resetScheduler();
  delete globals.inlineTick; delete globals.advanceInlineTick;
});
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();

for (const kind of ['owned', 'module']) {
  it(`${kind}: retains lightweight entries through selection, mutation, moves and key changes`, async () => {
    const specifier = `./fixtures/out/lightweight-inline-rows/${kind}.ts`;
    const { App } = await import(specifier); document.body.append(App('App', null));
    expect([..._internals().registry.keys()].filter(id => id.includes('/Row['))).toEqual([]);
    const first = document.querySelector('[data-id="1"]')!;
    const second = document.querySelector('[data-id="2"]')!;
    click('[data-id="1"]'); expect(first.className).toBe('selected');
    click('[data-id="2"]'); expect(first.className).toBe(''); expect(second.className).toBe('selected');
    click('[data-id="2"] [data-role="rename"]'); expect(second.querySelector('span')!.textContent).toBe('two!:1:0');
    click('#reverse'); expect(document.querySelectorAll('li')[1]).toBe(second);
    expect(document.querySelectorAll('li')[2]).toBe(first); expect(first.querySelector('span')!.textContent).toBe('one:2:0');
    const previousKeyNode = document.querySelector('[data-id="3"]');
    click('#key'); expect(document.querySelector('[data-id="13"]')).not.toBe(previousKeyNode);
    expect(second.className).toBe('selected');
    click('#remove'); expect(document.querySelector('[data-id="2"]')).toBeNull();
    expect(document.querySelectorAll('li')).toHaveLength(2);
    click('#clear'); expect(document.querySelectorAll('li')).toHaveLength(0);
    expect(document.querySelector('ul')!.childNodes).toHaveLength(2);
    unregisterSubtree('App'); expect(_internals().registry.size).toBe(0);
  });
  it(`${kind}: write-free events refresh the entry closure after an external effect`, async () => {
    const specifier = `./fixtures/out/lightweight-inline-rows/${kind}-events.ts`;
    const { App } = await import(specifier); document.body.append(App('App', null));
    document.querySelector('[data-id="1"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(document.querySelector('[data-id="1"] span')!.textContent).toBe('one:0:1');
    expect(document.querySelector('[data-id="2"] span')!.textContent).toBe('two:1:0');
  });
}

it('retains independently routed rows for general module reads', async () => {
  const specifier = './fixtures/out/lightweight-inline-rows/external.ts';
  const { App } = await import(specifier); document.body.append(App('App', null));
  expect([..._internals().registry.keys()].filter(id => id.includes('/Row['))).toHaveLength(3);
  click('#suffix'); expect([...document.querySelectorAll('li')].map(row => row.textContent)).toEqual(['one?', 'two?', 'three?']);
});

it('emits DOM-only teardown only for proven lightweight inline rows', () => {
  const code = compile(`export function App() { let items = ${rows};
    return <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>; }`);
  expect(code).toMatch(/\},\s*\(?item\)? => item.id,\s*false,\s*false,\s*true\s*\)/);
});

it('keeps row entities in hot builds and lists inside a conditional owner', () => {
  const code = compile(source(true), { hot: true });
  expect(code).toMatch(/\.registerEntity\(\{\s*id: _rowId\d*,/);
  const conditional = compile(`export function App() { let show = true; let items = ${rows};
    return <main><button onClick={() => show = !show}>toggle</button>
      {show ? <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul> : <p>hidden</p>}
    </main>; }`);
  expect(conditional).toMatch(/\.registerEntity\(\{\s*id: _rowId\d*,/);
});

it.each([
  ['ref', '<li key={item.id} ref={node => externalRef(node)}>{item.label}</li>'],
  ['child component', '<li key={item.id}><Child item={item}/></li>'],
  ['nested branch', '<li key={item.id}>{item.id ? <span>{item.label}</span> : <b>empty</b>}</li>'],
  ['nested list', '<li key={item.id}>{item.children.map(child => <b key={child.id}>{child.id}</b>)}</li>'],
  ['render call', '<li key={item.id}>{format(item.label)}</li>'],
  ['spread', '<li key={item.id} {...attrs}>{item.label}</li>'],
])('keeps entity ownership for %s', (_name, jsx) => {
  const code = compile(`function Child({item}) { return <span>{item.label}</span>; }
    function format(label) { return label; }
    export function App() { let items = ${rows}; return <ul>{items.map(item => ${jsx})}</ul>; }`);
  expect(code).toMatch(/\.registerEntity\(\{\s*id: _rowId\d*,/);
});

it('retains entity ownership for replayed callback statements', () => {
  const code = compile(`export function App() { let items = ${rows}; return <ul>{items.map(item => {
    console.log(item.id); return <li key={item.id}>{item.label}</li>;
  })}</ul>; }`);
  expect(code).toMatch(/\.registerEntity\(\{\s*id: _rowId\d*,/);
});

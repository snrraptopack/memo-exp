import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { compileModules } from '../packages/compiler/src/linker';
import { registeredIds, resetScheduler, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';
import { setProps } from '@memoized-dom/runtime';

const directory = join(import.meta.dirname, 'fixtures/out/private-multi-row-props');
const globals = globalThis as typeof globalThis & {
  multiRowRead?: () => string;
  multiRowProp?: (kind: string, value: unknown) => unknown;
};
const row = `function Row(props) {
  return <li class={props.selected ? 'chosen' : ''} onClick={() => props.select(props.item.id)}>
    {props.item.label}
  </li>;
}`;
function source(declaration = row, select = 'const select = id => { selected = id; };') {
  return `${declaration} export function App({items}) {
    let selected = null; ${select}
    return <ul>{items.map(item => <Row key={item.id} item={item} selected={selected === item.id} select={select}/>)}</ul>;
  }`;
}
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const kind of ['local', 'linked']) {
    const input = source();
    const code = kind === 'linked' ? compileModules({'./rows.tsx': input})['./rows.tsx']! : compile(input);
    writeFileSync(join(directory, kind + '.ts'), code);
  }
  writeFileSync(join(directory, 'ordered.ts'), compile(`function Row(props) {
    return <li onClick={() => { globalThis.multiRowRead = () => props.first + ':' + props.second; }}>
      {props.second}:{props.first}
    </li>;
  } export function App({items}) { return <ul>{items.map(item => <Row key={item.id}
    first={globalThis.multiRowProp('first', item.first)} second={globalThis.multiRowProp('second', item.second)}/>)}</ul>; }`));
});
afterEach(() => {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler(); document.body.replaceChildren(); delete globals.multiRowRead; delete globals.multiRowProp;
});

it.each(['local','linked'])('%s: creates, replaces and reorders rows with current selection callbacks', async kind => {
  setScheduler(fn => fn());
  const specifier = `./fixtures/out/private-multi-row-props/${kind}.ts`;
  const {App} = await import(specifier);
  document.body.append(App('App', null, [{items:[{id:1,label:'one'},{id:2,label:'two'}]}]));
  const rows = [...document.querySelectorAll('li')]; (rows[0] as HTMLElement).click();
  expect(rows.map(node => node.className)).toEqual(['chosen','']);
  setProps('App', [{items:[{id:2,label:'TWO'},{id:1,label:'ONE'}]}]);
  expect([...document.querySelectorAll('li')]).toEqual([rows[1],rows[0]]);
  expect(rows.map(node => node.textContent)).toEqual(['ONE','TWO']);
  (rows[1] as HTMLElement).click(); expect(rows.map(node => node.className)).toEqual(['','chosen']);
  setProps('App', [{items:[{id:3,label:'three'}]}]);
  expect(document.querySelector('li')).not.toBe(rows[0]); expect(document.querySelector('li')!.textContent).toBe('three');
  (document.querySelector('li') as HTMLElement).click(); expect(document.querySelector('li')!.className).toBe('chosen');
});

it('keeps authored attribute order and stages all new values before replay, including failure', async () => {
  setScheduler(() => {}); const calls: string[] = []; let checking = false, fail = true;
  globals.multiRowProp = (kind, value) => {
    calls.push(kind);
    if (checking) { expect(globals.multiRowRead!()).toBe('a:b'); if (fail && kind === 'second') throw new Error('second'); }
    return value;
  };
  const specifier = './fixtures/out/private-multi-row-props/ordered.ts'; const {App} = await import(specifier);
  document.body.append(App('App', null, [{items:[{id:1,first:'a',second:'b'}]}]));
  const node = document.querySelector('li') as HTMLElement; node.click(); expect(calls).toEqual(['first','second']);
  checking = true; calls.length = 0;
  setProps('App', [{items:[{id:1,first:'A',second:'B'}]}]);
  // Render explicitly to inspect the throwing evaluation before the scheduler runs.
  const {getEntity} = await import('@memoized-dom/runtime');
  expect(() => getEntity('App')!.render()).toThrow('second');
  expect(calls).toEqual(['first','second']); expect(globals.multiRowRead!()).toBe('a:b'); expect(node.textContent).toBe('b:a');
  fail = false; getEntity('App')!.render(); checking = false;
  expect(globals.multiRowRead!()).toBe('A:B'); expect(node.textContent).toBe('B:A');
});

it.each([
  ['ordinary function receiver', source(row, 'const select = function(id) { globalThis.inspect(this); selected = id; };')],
  ['mutable callback', source(row, 'let select = id => { selected = id; };')],
  ['opaque callback', source(row, 'const select = globalThis.chooseCallback();')],
  ['envelope escape', source(row.replace('props.select(props.item.id)', 'globalThis.inspect(props)'))],
  ['field assignment', source(row.replace('props.select(props.item.id)', 'props.selected = true'))],
  ['different site order', source().replace('</ul>', '{items.map(item => <Row key={item.id} selected={selected === item.id} item={item} select={select}/>)}</ul>')],
  ['unknown receiver at another site', source().replace('</ul>', '{items.map(item => <Row key={item.id} item={item} selected={false} select={globalThis.other}/>)}</ul>')],
])('keeps the envelope for %s', (_name, input) => {
  expect(compile(input)).not.toMatch(/function Row\(_rowProp/);
});

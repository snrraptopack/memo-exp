import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/owner-list-structure');
const replayGate = /\.reconcile\(items, [^\n]*\.reasonsOnly\(/;
const data = "let items=[{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}];";
const basic = `${data}return <main><button onClick={()=>{items=[items[2],items[0],items[1]]}}>rotate</button>
  <ul>{items.map(item=><li key={item.id}>{item.id}:{item.label}</li>)}</ul></main>;`;
const compile = (body: string) => compileModules({ './app.tsx': `
  function Row({item}){return <li>{item.label}</li>;}
  export function App(){${body}}` })['./app.tsx']!;
const probe = `import * as runtime from '@memoized-dom/runtime/testing';
  export * from '@memoized-dom/runtime/testing';
  export function createListRegion(...args){const create=args[2];args[2]=(...values)=>{
    const entry=create(...values),update=entry.update;
    if(update) entry.update=()=>{globalThis.__ownerRowReplays++;update();};return entry;
  };return runtime.createListRegion(...args);}`;
async function load(source: string, name: string) {
  const output = compileModules({ './app.tsx': source }, { runtimePath: './probe' })['./app.tsx']!;
  const target = join(directory, name); mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'app.ts'), output); writeFileSync(join(target, 'probe.ts'), probe);
  const specifier = `./fixtures/out/owner-list-structure/${name}/app.ts`;
  return { output, App: (await import(specifier)).App };
}

beforeEach(() => {
  document.body.replaceChildren(); resetAccessTable();
  vi.stubGlobal('__ownerRowReplays', 0);
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable(); resetScheduler(); vi.unstubAllGlobals();
});

for (const escaped of [false, true]) it.each([false, true])(`retains identity and mixed/replacement replay (alias=${escaped}, deferred=%s)`, async deferred => {
  const count = 20;
  const entries = Array.from({ length: count }, (_, index) => `{id:${index},label:'row ${index}'}`).join(',');
  const reverse = Array.from({ length: count }, (_, index) => `items[${count - index - 1}]`).join(',');
  const replacements = Array.from({ length: count }, (_, index) => `{id:${index},label:'new ${index}'}`).join(',');
  const source = `export function App(){let items=[${entries}];${escaped ? 'const alias=items;' : ''}let suffix=0;const length=items.length;
    return <main><output>{length}:{suffix}</output>
      <button onClick={()=>{items=[${reverse}]}}>reverse</button>
      <button onClick={()=>{suffix++}}>suffix</button>
      <button onClick={()=>{items=[${reverse}];suffix++}}>mixed</button>
      <button onClick={()=>{items=[${replacements}]}}>replace</button>
      <ul>{items.map(item=><li key={item.id}>{item.id}:{item.label}</li>)}</ul>
    </main>;}`;
  const { output, App } = await load(source, `${escaped}-${deferred}`);
  if (escaped) expect(output).not.toMatch(replayGate); else expect(output).toMatch(replayGate);
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const flush = () => { while (pending.length) pending.shift()!(); };
  document.body.append(App('First', null), App('Second', null)); flush();
  const roots = [...document.querySelectorAll('main')];
  const nodes = roots.map(root => [...root.querySelectorAll('li')]);
  const click = (label: string) => [...roots[0]!.querySelectorAll('button')].find(button => button.textContent === label)!.click();
  const reads = () => (globalThis as unknown as { __ownerRowReplays: number }).__ownerRowReplays;
  const check = (order: number[], label: string, suffix: number) => {
    expect([...roots[0]!.querySelectorAll('li')]).toEqual(order.map(id => nodes[0]![id]));
    [...roots[0]!.querySelectorAll('li')].forEach((node, index) => expect(node.textContent).toBe(`${order[index]}:${label} ${order[index]}`));
    expect(roots[0]!.querySelector('output')!.textContent).toBe(`${count}:${suffix}`);
    expect([...roots[1]!.querySelectorAll('li')]).toEqual(nodes[1]);
    nodes[1]!.forEach((node, id) => expect(node.textContent).toBe(`${id}:row ${id}`));
    expect(roots[1]!.querySelector('output')!.textContent).toBe(`${count}:0`);
  };
  const ids = Array.from({ length: count }, (_, id) => id);
  let expected = escaped ? count : 0;
  click('reverse'); flush(); check(ids.toReversed(), 'row', 0); expect(reads()).toBe(expected);
  expected += count;
  click('mixed'); flush(); check(ids, 'row', 1); expect(reads()).toBe(expected);
  // Separate publications in one deferred batch must retain the ordinary cause.
  click('reverse'); click('suffix'); flush(); check(ids.toReversed(), 'row', 2);
  expected += deferred || !escaped ? count : count * 2;
  expect(reads()).toBe(expected);
  click('replace'); flush(); check(ids, 'new', 2);
  expect(reads()).toBe(expected + count);
});

it.each([false, true])('refreshes changed indices and immutable indexed replacements (indexSensitive=%s)', async indexSensitive => {
  const { output, App } = await load(`export function App(){${data}const length=items.length;
    return <main><output>{length}</output>
      <button onClick={()=>{items=[items[2],items[0],items[1]]}}>rotate</button>
      <button onClick={()=>{items[0]={id:3,label:'THREE'}}}>replace</button>
      <button onClick={()=>{items=[items[0],items[1],items[2],{id:4,label:'four'}]}}>append</button>
      <ul>{items.map(${indexSensitive ? '(item,index)' : 'item'}=><li key={item.id}>{item.label}${indexSensitive ? ':{index}' : ''}</li>)}</ul>
    </main>;}`, `index-${indexSensitive}`);
  expect(output).toMatch(replayGate);
  setScheduler(run => run()); document.body.append(App('Index', null));
  const nodes = [...document.querySelectorAll('li')];
  const buttons = [...document.querySelectorAll('button')];
  const reads = () => (globalThis as unknown as { __ownerRowReplays: number }).__ownerRowReplays;
  buttons[0]!.click(); expect(reads()).toBe(indexSensitive ? 3 : 0);
  expect([...document.querySelectorAll('li')]).toEqual([nodes[2],nodes[0],nodes[1]]);
  expect(nodes[2]!.textContent).toBe(indexSensitive ? 'three:0' : 'three');
  buttons[1]!.click(); expect(reads()).toBe(indexSensitive ? 4 : 1);
  expect(nodes[2]!.textContent).toBe(indexSensitive ? 'THREE:0' : 'THREE');
  buttons[2]!.click(); expect(reads()).toBe(indexSensitive ? 4 : 1);
  expect([...document.querySelectorAll('li')].slice(0,3)).toEqual([nodes[2],nodes[0],nodes[1]]);
  expect(document.querySelector('output')!.textContent).toBe('4');
  expect(document.querySelectorAll('li')[3]!.textContent).toBe(indexSensitive ? 'four:3' : 'four');
});

it.each([
  basic.replace("id:1,label:'one'", "get id(){return 1},label:'one'"),
  basic.replace("id:1,label:'one'", "id:1,get label(){return 'one'}"),
  basic.replace('return <main>', 'const alias=items;return <main>'),
  basic.replace('return <main>', 'opaque(items);return <main>'),
  basic.replace('return <main>', 'items[0].label="changed";return <main>'),
  basic.replace('return <main>', 'const escaped=items[0];return <main>'),
  basic.replace('return <main>', 'for(items[0].label of ["changed"]){}return <main>'),
  basic.replace('return <main>', '[items[0].label]=["changed"];return <main>'),
  basic.replace('return <main>', 'items.reverse();return <main>'),
  basic.replace('items=[items[2],items[0],items[1]]', 'items=opaque()'),
  basic.replace('items=[items[2],items[0],items[1]]', 'items=[...items]'),
  basic.replace('item.id}:{item.label', 'item.id}:{clock.value}:{item.label'),
  basic.replace('{item.label}', '{opaque(item.label)}'),
  basic.replace('<li key={item.id}', '<li onClick={()=>{item.label="changed"}} key={item.id}'),
  basic.replace('<li key={item.id}', '<li onClick={()=>{for(item.label of ["changed"]) {}}} key={item.id}'),
  basic.replace('key={item.id}', 'key={clock.key(item.id)}'),
  basic.replace('<li key={item.id}>{item.id}:{item.label}</li>', '<Row key={item.id} item={item}/>'),
  basic.replace('return <main>', "eval('items[0].label=1');return <main>"),
  basic.replace('return <main>', 'items.length=1;return <main>'),
  basic.replace('items=[items[2],items[0],items[1]]', 'items=[items[20],items[0],items[1]]'),
  basic.replace('items=[items[2],items[0],items[1]]', 'items=[items[0],,items[1]]'),
])('keeps full replay when the closed structural proof fails: %#', source => {
  expect(compile(source)).not.toMatch(replayGate);
});

it('proves literal truncation and fresh replacement without permitting retained field writes', () => {
  const source = `${data}return <main><button onClick={()=>{items.length=0}}>clear</button>
    <button onClick={()=>{items=[{id:4,label:'four'}]}}>replace</button>
    <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;`;
  expect(compile(source)).toMatch(replayGate);
  expect(compile(source.replace('items.length=0', 'items[0].label="changed"'))).not.toMatch(replayGate);
  expect(compile(source.replace('items.length=0', 'items.length=1;items.length=2'))).not.toMatch(replayGate);
});

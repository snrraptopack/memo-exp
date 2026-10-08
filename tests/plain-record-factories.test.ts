import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModules } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const probe = globalThis as typeof globalThis & { recordFactoryRenders?: number[] };
const calls = Array.from({ length: 24 }, (_, id) => `row(${id}, prefix)`).join(',');
const factory = `function row(id, prefix) {
  const label = prefix + ':' + id;
  const record = {id, label};
  const alias = record;
  return alias;
}`;
function source(owner: boolean, component: boolean, helper = factory, array = `const make = prefix => [${calls}];`) {
  const state = "let items = make('row');";
  return `${helper} ${array}
    function trace(id, value) { globalThis.recordFactoryRenders.push(id); return value; }
    function Row({item}) { return <li>{trace(item.id, item.label)}</li>; }
    ${owner ? '' : state}
    export function App() { ${owner ? state : ''}
      return <main><button onClick={() => {
        ${owner ? 'for(let i=0;i<items.length;i+=10) items[i].label += "!";' : 'items[0].label += "!";'}
      }}>update</button><ul>{items.map(item => ${component
        ? '<Row key={item.id} item={item}/>' : '<li key={item.id}>{trace(item.id, item.label)}</li>'})}</ul></main>;
    }`;
}

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/record-factories');
  mkdirSync(directory, { recursive: true });
  for (const owner of [false, true]) for (const component of [false, true]) {
    const input = source(owner, component);
    const list = input.slice(input.indexOf('<ul>'), input.indexOf('</ul>') + 5);
    const code = compile(owner ? input : input.replace('</main>', `${list}</main>`));
    expect(code).toContain(owner ? 'ChangedKeys.add(items[i].id)' : 'commitListItemWrites');
    for (const deferred of [false, true]) writeFileSync(join(directory, `${owner}-${component}-${deferred}.ts`), code);
  }
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); document.body.replaceChildren(); delete probe.recordFactoryRenders;
});

for (const owner of [false, true]) for (const component of [false, true]) {
  it.each([false, true])(`record factory owner=${owner}, component=${component}, deferred=%s`, async deferred => {
    const pending: Array<() => void> = [];
    setScheduler(run => { if (deferred) pending.push(run); else run(); });
    const renders: number[] = []; probe.recordFactoryRenders = renders;
    const specifier = `./fixtures/out/record-factories/${owner}-${component}-${deferred}.ts`;
    const { App } = await import(specifier);
    document.body.append(...(owner ? [App('First', null), App('Second', null)] : [App('App', null)]));
    const lists = [...document.querySelectorAll('ul')];
    const nodes = lists.map(list => [...list.children]);
    for (let update = 1; update <= 2; update++) {
      renders.length = 0;
      document.querySelector<HTMLButtonElement>('button')!.click();
      while (pending.length) pending.shift()!();
      expect(renders).toEqual(owner ? [0, 10, 20] : [0, 0]);
      lists.forEach((list, instance) => nodes[instance]!.forEach((row, id) => {
        expect(list.children[id]).toBe(row);
        const changed = owner ? instance === 0 && id % 10 === 0 : id === 0;
        expect(row.textContent).toBe(`row:${id}` + (changed ? '!'.repeat(update) : ''));
      }));
    }
  });
}

it.each([
  'function row(id, prefix) { return {id, label:prefix+":"+id}; }',
  'const row = (id, prefix) => ({id, label:`${prefix}:${id}`});',
  'const row = function(id, prefix) { const label=prefix+":"+id; return {id,label}; };',
  'const row = (id, prefix) => { const record={id,label:prefix+":"+id}, alias=record; return alias; };',
])('proves a fresh record factory: %s', helper => {
  expect(compile(source(true, false, helper))).toContain('ChangedKeys.add(items[i].id)');
});

it('composes array and record aliases and accepts direct records alongside calls', () => {
  expect(compile(source(true, true, factory, `function make(prefix) {
    const rows=[{id:24,label:prefix},${calls}], alias=rows; return alias;
  }`))).toContain('ChangedKeys.add(items[i].id)');
});

it('accepts record calls in a directly initialized literal array', () => {
  expect(compile(source(true, false, factory).replace("make('row')", '[row(0,"row"),row(1,"row")]')))
    .toContain('ChangedKeys.add(items[i].id)');
});

it.each([
  'const row = opaque;',
  'let row = (id,prefix) => ({id,label:prefix});',
  'const row = (id,prefix) => { observe(); return {id,label:prefix}; };',
  'const row = async (id,prefix) => ({id,label:prefix});',
  'function* row(id,prefix) { return {id,label:prefix}; }',
  'const row = (id,prefix="row") => ({id,label:prefix});',
  'const row = (...args) => ({id:args[0],label:args[1]});',
  'const row = (id,{prefix}) => ({id,label:prefix});',
  'const row = (id,prefix) => ({id,get label(){return prefix;}});',
  'const row = (id,prefix) => ({id,label:{value:prefix}});',
  'const row = (id,prefix) => ({id,...opaque});',
  'const row = (id,prefix) => ({id,label:globalThis.prefix});',
  'const row = (id,prefix) => ({id,label:opaque(prefix)});',
  'const row = (id,prefix) => ({id,label:prefix.value});',
  'const row = (id,prefix) => ({id,label:prefix,__proto__:null});',
  'const row = (id,prefix) => ({id,label:prefix,label:"other"});',
  'const row = (id,prefix) => ({id,["label"]:prefix});',
  'const row = (id,prefix) => { const record={id,label:prefix}; observe(record); return record; };',
  'const row = (id,prefix) => { const record={id,label:prefix}; const alias=record; globalThis.saved=alias; return record; };',
  'const row = (id,prefix) => { const record={id,label:prefix}; record.label="other"; return record; };',
  'const row = (id,prefix) => { const unused={get label(){return opaque();}}; return {id,label:prefix}; };',
  'const row = (id,prefix) => { prefix="other"; return {id,label:prefix}; };',
  'const row = (id,prefix) => { const label=prefix; label="other"; return {id,label}; };',
  'const row = (id,prefix) => { let record={id,label:prefix}; return record; };',
  'const original=(id,prefix)=>({id,label:prefix}); const row=original;',
])('keeps fallback for an unproven record factory: %s', helper => {
  expect(compile(source(true, false, helper))).not.toContain('ChangedKeys.add(items[i].id)');
});

it.each([
  'row(0, opaque())', 'row(0, globalThis.prefix)', 'row.call(null, 0, prefix)',
  'row?.(0,prefix)', 'row(0, ...prefix)',
])('does not infer safe inputs or receivers: %s', call => {
  expect(compile(source(true, false, factory, `const make=prefix=>[${call}];`)))
    .not.toContain('ChangedKeys.add(items[i].id)');
});

it('checks actual bindings, captured values and later writes independently', () => {
  expect(compile(source(true, false, factory).replace('let items =', 'row=opaque; let items =')))
    .not.toContain('ChangedKeys.add(items[i].id)');
  expect(compile(source(true, false, 'const captured="other"; const row=(id,label)=>({id,label:captured});')))
    .not.toContain('ChangedKeys.add(items[i].id)');
  expect(compile(source(true, false, factory).replace('items[i].label += "!"', 'items[i].label = opaque()')))
    .not.toContain('ChangedKeys.add(items[i].id)');
  expect(compile(source(true, false, factory).replace('items[i].label += "!"', 'items[i].id++')))
    .not.toContain('ChangedKeys.add(items[i].id)');
});

it('rejects imported factories and shadowed opaque bindings', () => {
  const linked = compileModules({
    './app.tsx': source(true, false, 'import {row} from "./records";'),
    './records.ts': 'export const row=(id,prefix)=>({id,label:prefix});',
  });
  expect(linked['./app.tsx'])
    .not.toContain('ChangedKeys.add(items[i].id)');
  expect(compile(source(true, false, factory, 'const make=prefix=>{const row=opaque;return [row(0,prefix)];};')))
    .not.toContain('ChangedKeys.add(items[i].id)');
});

it('keeps indexed-fill producers conservative because prototype setters can observe writes', () => {
  const input = source(true, false, factory, `function make(prefix) {
    const rows=[]; for(let i=0;i<24;i++) rows[i]=row(i,prefix); return rows;
  }`);
  expect(compile(input)).not.toContain('ChangedKeys.add(items[i].id)');
});

it('keeps broad refresh for factories returning shared records', () => {
  expect(compile(source(true, false, 'const shared={id:0,label:"row"}; const row=(id,prefix)=>shared;')))
    .not.toContain('ChangedKeys.add(items[i].id)');
});

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/owner-refresh-coalescing');
const probe = `import * as runtime from '@memoized-dom/runtime/testing';
  export * from '@memoized-dom/runtime/testing';
  export function createListRegion(...args){const create=args[2];args[2]=(...values)=>{
    const entry=create(...values);
    const update=entry.update;
    if(update) entry.update=(...args)=>{globalThis.__ownerRefreshCounts.updates++;update(...args);};
    return entry;
  };const region=runtime.createListRegion(...args),reconcile=region.reconcile;
  region.reconcile=(...values)=>{globalThis.__ownerRefreshCounts.reconciles++;return reconcile(...values);};
  return region;}`;
const counts = () => (globalThis as unknown as {
  __ownerRefreshCounts: { reconciles: number; updates: number };
}).__ownerRefreshCounts;
const resetCounts = () => { counts().reconciles = 0; counts().updates = 0; };

async function load(sources: Record<string, string>, name: string) {
  const output = compileModules(sources, { runtimePath: './probe' });
  const target = join(directory, name);
  mkdirSync(target, { recursive: true });
  for (const [path, code] of Object.entries(output)) {
    writeFileSync(join(target, path.replace(/\.tsx$/, '.ts')), code);
  }
  writeFileSync(join(target, 'probe.ts'), probe);
  const specifier = `./fixtures/out/owner-refresh-coalescing/${name}/App.ts`;
  return import(specifier);
}

beforeEach(() => {
  document.body.replaceChildren(); resetAccessTable();
  vi.stubGlobal('__ownerRefreshCounts', { reconciles: 0, updates: 0 });
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable(); resetScheduler(); vi.unstubAllGlobals();
});

it.each([false, true])('publishes each Octane rotation once (deferred=%s)', async deferred => {
  const rowCount = 20;
  const source = join(import.meta.dirname, '../bench/octane/memoized-dom');
  const { OctaneBench } = await load({
    './App.tsx': readFileSync(join(source, 'App.tsx'), 'utf8').replaceAll('buildData(1000)', `buildData(${rowCount})`),
    './model.ts': readFileSync(join(source, 'model.ts'), 'utf8'),
  }, `octane-${deferred}`);
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const flush = () => {
    for (let turns = 0; pending.length; turns++) {
      if (turns >= 50) throw new Error('Owner refresh failed to settle');
      pending.shift()!();
    }
  };
  document.body.append(OctaneBench('Octane', null)); flush();
  const click = (id: string) => { document.getElementById(id)!.click(); flush(); };
  const rows = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  for (const id of ['rotatef', 'rotateb']) {
    resetCounts(); click(id);
    expect(counts()).toEqual({ reconciles: 0, updates: 0 });
  }
  click('run');
  const original = rows();
  const labels = original.map(row => row.cells[1]!.textContent);
  original[4]!.cells[1]!.querySelector('a')!.click(); flush();
  expect(original[4]!.className).toBe('danger');
  resetCounts(); click('rotatef');
  expect(counts()).toEqual({ reconciles: 1, updates: rowCount });
  rows().forEach((row, index) => expect(row).toBe(original[(index + rowCount - 1) % rowCount]));
  resetCounts(); click('rotateb');
  expect(counts()).toEqual({ reconciles: 1, updates: rowCount });
  rows().forEach((row, index) => expect(row).toBe(original[index]));
  expect(original[4]!.className).toBe('danger');
  expect(original.map(row => row.cells[1]!.textContent)).toEqual(labels);
  click('update');
  rows().forEach((row, index) => expect(row).toBe(original[index]));
  expect(original.map(row => row.cells[1]!.textContent)).toEqual(
    labels.map((label, index) => index % 10 === 0 ? `${label} !!!` : label),
  );
});

it.each([false, true])('accepts an unknown mutating method (same array=%s)', async sameArray => {
  const { App } = await load({
    './model.ts': `export function makeItems(){
      const items=[{id:1,label:'one'},{id:2,label:'two'}];
      items.inspect=function(){this[0].label+='!';return ${sameArray ? 'this' : '[this[1],this[0]]'};};return items;
    }`,
    './App.tsx': `import {makeItems} from './model';export function App(){
      let items=makeItems();const rotate=()=>{items=items.length===0?items:items.inspect();};
      return <main><button onClick={rotate}>rotate</button>
        <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;
    }`,
  }, `unknown-method-${sameArray}`);
  setScheduler(run => run()); document.body.append(App('Custom', null));
  const original = [...document.querySelectorAll('li')];
  resetCounts(); document.querySelector('button')!.click();
  expect(counts()).toEqual({ reconciles: 1, updates: 2 });
  expect([...document.querySelectorAll('li')]).toEqual(sameArray ? original : [original[1], original[0]]);
  expect(original.map(row => row.textContent)).toEqual(['one!', 'two']);
});

it('preserves getter reads and live event bindings in a fused opaque row', async () => {
  vi.stubGlobal('__rowReads', []);
  const { App } = await load({
    './model.ts': `export function makeItems(){return [1,2].map(id=>({
      get id(){globalThis.__rowReads.push('id'+id);return id;},
      get label(){globalThis.__rowReads.push('label'+id);return 'row'+id;}
    }));}`,
    './App.tsx': `import {makeItems} from './model';export function App(){let items=makeItems();let selected=0;
      return <main><button id="rotate" onClick={()=>{items=items.toReversed();}}>rotate</button>
        <button id="replace" onClick={()=>{items=makeItems();}}>replace</button>
        <ul>{items.map((item,index)=><li key={item.id} class={selected===item.id?'danger':''}>
          <a onClick={()=>{selected=item.id;}}>{item.id}:{item.label}:{index}</a></li>)}</ul></main>;}`,
  }, 'fused-getters');
  setScheduler(run=>run()); document.body.append(App('FusedGetters',null));
  const original=[...document.querySelectorAll('li')];
  const reads=(globalThis as unknown as {__rowReads:string[]}).__rowReads;
  reads.length=0;resetCounts();document.getElementById('rotate')!.click();
  expect(reads).toEqual(['id2','id2','label2','id2','id1','id1','label1','id1']);
  expect(counts()).toEqual({reconciles:1,updates:2});
  expect([...document.querySelectorAll('li')]).toEqual([original[1],original[0]]);
  expect(original.map(row=>row.textContent)).toEqual(['1:row1:1','2:row2:0']);
  original[0]!.querySelector('a')!.click();
  expect(original[0]!.className).toBe('danger');
  document.getElementById('replace')!.click();
  expect([...document.querySelectorAll('li')]).toEqual(original);
  original[1]!.querySelector('a')!.click();
  expect(original[0]!.className).toBe('');expect(original[1]!.className).toBe('danger');
});

it('retains a row-handler updater when the handler mutates row content', async () => {
  const {App}=await load({
    './model.ts': `export function makeItems(){return [1,2].map(id=>({id,label:'row'+id}));}`,
    './App.tsx': `import {makeItems} from './model';export function App(){let items=makeItems();
      return <main><button onClick={()=>{items=items.toReversed();}}>rotate</button>
        <ul>{items.map(item=><li key={item.id}><a onClick={()=>{item.label+='!';}}>{item.label}</a></li>)}</ul></main>;}`,
  },'row-handler-update');
  setScheduler(run=>run());document.body.append(App('RowHandlerUpdate',null));
  const original=[...document.querySelectorAll('li')];
  original[0]!.querySelector('a')!.click();
  expect(original[0]!.textContent).toBe('row1!');
  document.querySelector('button')!.click();
  expect([...document.querySelectorAll('li')]).toEqual([original[1],original[0]]);
  original[0]!.querySelector('a')!.click();
  expect(original[0]!.textContent).toBe('row1!!');
});

it.each([false, true])('skips retained content through imported helper chains without skipping mixed causes (deferred=%s)', async deferred => {
  const { App } = await load({
    './rows.ts': `export function makeRows(suffix){const first={id:1,label:'one'+suffix};
      return [first,{id:2,label:'two'+suffix},{id:3,label:'three'+suffix}];}
      export function rotate(rows){const last=rows[2];const first=rows[0];return [last,first,rows[1]];}`,
    './bridge.ts': `import {makeRows as build,rotate as reorder} from './rows';
      export function create(suffix){return build(suffix);}
      export function move(rows){return reorder(rows);}`,
    './App.tsx': `import {create as makeRows,move as rotate} from './bridge';
      export function App(){let items=makeRows(0);let selected=0;const select=id=>{selected=id;};
      return <main>
        <button id="rotate" onClick={()=>{items=rotate(items);}}>rotate</button>
        <button id="rename" onClick={()=>{items[0].label='renamed';}}>rename</button>
        <button id="replace" onClick={()=>{items=makeRows(1);}}>replace</button>
        <button id="mixed" onClick={()=>{items=rotate(items);selected=1;}}>mixed</button>
        <ul>{items.map(item=><li key={item.id} class={selected===item.id?'danger':''}>
          <a onClick={()=>select(item.id)}>{item.label}</a></li>)}</ul>
      </main>;}`,
  }, `imported-${deferred}`);
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const flush = () => { for (let turns = 0; pending.length; turns++) {
    if (turns >= 50) throw new Error('Owner refresh failed to settle'); pending.shift()!();
  }};
  document.body.append(App('Imported', null)); flush();
  const original = [...document.querySelectorAll('li')];
  const click = (id: string) => { document.getElementById(id)!.click(); flush(); };
  const order = () => [...document.querySelectorAll('li')];
  resetCounts(); click('rotate');
  expect(counts()).toEqual({ reconciles: 1, updates: 0 });
  expect(order()).toEqual([original[2],original[0],original[1]]);
  resetCounts(); click('rename');
  expect(original[2]!.textContent).toBe('renamed');
  expect(counts().updates).toBeGreaterThan(0);
  original[1]!.querySelector('a')!.click(); flush();
  expect(original[1]!.className).toBe('danger');
  resetCounts(); click('rotate');
  expect(counts().updates).toBe(0);
  expect(original[1]!.className).toBe('danger');
  resetCounts(); click('mixed');
  expect(counts().updates).toBe(3);
  expect(original[0]!.className).toBe('danger');
  expect(original[1]!.className).toBe('');
  resetCounts(); click('replace');
  expect(order()).toEqual(original);
  expect(original.map(row=>row.textContent)).toEqual(['one1','two1','three1']);
  expect(counts().updates).toBe(3);
  resetCounts(); document.getElementById('rotate')!.click();
  original[1]!.querySelector('a')!.click(); flush();
  expect(original[0]!.className).toBe('');
  expect(original[1]!.className).toBe('danger');
  expect(counts().updates).toBe(deferred ? 3 : 2);
});

it('refreshes indices on imported reorders', async () => {
  const { App } = await load({
    './rows.ts': `export function create(){return [{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}];}
      export function reorder(rows){return [rows[2],rows[0],rows[1]];}`,
    './App.tsx': `import {create,reorder} from './rows';export function App(){let items=create();
      return <main><button onClick={()=>{items=reorder(items);}}>rotate</button>
      <ul>{items.map((item,index)=><li key={item.id}>{item.label}:{index}</li>)}</ul></main>;}`,
  }, 'imported-indices');
  setScheduler(run=>run()); document.body.append(App('Indices',null));
  const original = [...document.querySelectorAll('li')];
  resetCounts(); document.querySelector('button')!.click();
  expect([...document.querySelectorAll('li')]).toEqual([original[2],original[0],original[1]]);
  expect(original.map(row=>row.textContent)).toEqual(['one:1','two:2','three:0']);
  expect(counts().updates).toBe(3);
});

it('retains replay for a helper that mutates an input record', async () => {
  const { App } = await load({
    './rows.ts': `export function create(){return [{id:1,label:'one'},{id:2,label:'two'}];}
      export function reorder(rows){rows[0].label='changed';return [rows[1],rows[0]];}`,
    './App.tsx': `import {create,reorder} from './rows';export function App(){let items=create();
      return <main><button onClick={()=>{items=reorder(items);}}>rotate</button>
      <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,
  }, 'imported-mutation');
  setScheduler(run=>run()); document.body.append(App('Mutation',null));
  const original = [...document.querySelectorAll('li')];
  resetCounts(); document.querySelector('button')!.click();
  expect([...document.querySelectorAll('li')]).toEqual([original[1],original[0]]);
  expect(original[0]!.textContent).toBe('changed');
  expect(counts().updates).toBeGreaterThanOrEqual(2);
});

it.each([false, true])('checks discarded input reads through helper chains (wrapped=%s)', async wrapped => {
  const { App } = await load({
    './rows.ts': `export function project(rows){const ignored=rows[999];return [rows[1],rows[0]];}
      export function reorder(rows){return ${wrapped ? 'project(rows)' : '[rows[1],rows[0]]'};}`,
    './bridge.ts': `import {project,reorder} from './rows';export function move(rows){return ${wrapped ? 'reorder' : 'project'}(rows);}`,
    './App.tsx': `import {move} from './bridge';export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];
      return <main><button onClick={()=>{items=move(items);}}>rotate</button>
      <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,
  }, `discarded-read-${wrapped}`);
  setScheduler(run=>run()); document.body.append(App('DiscardedRead',null));
  const original = [...document.querySelectorAll('li')];
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, '999');
  Object.defineProperty(Array.prototype, '999', { configurable: true, get() {
    this[0].label='changed'; return undefined;
  }});
  try {
    resetCounts(); document.querySelector('button')!.click();
    expect([...document.querySelectorAll('li')]).toEqual([original[1],original[0]]);
    expect(original[0]!.textContent).toBe('changed');
    expect(counts().updates).toBe(2);
  } finally {
    if (previous === undefined) delete (Array.prototype as unknown as Record<string, unknown>)['999'];
    else Object.defineProperty(Array.prototype, '999', previous);
  }
});

it.each([
  `let selected=0;globalThis.__selectLater=()=>{selected=2;};`,
  `let selected={valueOf(){return 2;}};`,
])('retains replay for an unpublished or coercive row dependency: %s', selected => {
  const expression = selected.includes('valueOf') ? 'selected+item.id' : "selected===item.id?'danger':''";
  const output = compileModules({
    './rows.ts': `export function create(){return [{id:1,label:'one'},{id:2,label:'two'}];}
      export function reorder(rows){return [rows[1],rows[0]];}`,
    './App.tsx': `import {create,reorder} from './rows';export function App(){let items=create();${selected}
      return <main><button onClick={()=>{items=reorder(items);}}>rotate</button>
      <ul>{items.map(item=><li key={item.id} class={${expression}}>{item.label}</li>)}</ul></main>;}`,
  })['./App.tsx']!;
  expect(output).not.toMatch(/\.reconcile\(items, [^\n]*\.reasonsOnly\(/);
});

it.each([
  `export function create(){return [{id:1,get label(){return 'one';}},{id:2,label:'two'}];}`,
  `const rows=[{id:1,label:'one'},{id:2,label:'two'}];export function create(){return rows;}`,
  `let saved;export function create(){const rows=[{id:1,label:'one'},{id:2,label:'two'}];saved=rows;return rows;}`,
  `export function create(){return [{id:1,label:'one'},,{id:2,label:'two'}];}`,
  `export function create(){const rows=[{id:1,label:'one'},{id:2,label:'two'}];return [...rows];}`,
  `export function create(){const rows=[{id:1,label:'one'},{id:2,label:'two'}];return rows.slice();}`,
  `export function create(){return [{id:1,label:'one'},{id:2,label:'two'}];}export function change(){eval('create = () => []');}`,
])('keeps opaque return provenance conservative: %s', factory => {
  const output = compileModules({
    './rows.ts': `${factory}export function reorder(rows){return [rows[1],rows[0]];}`,
    './App.tsx': `import {create,reorder} from './rows';export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];
      return <main><button onClick={()=>{items=create();items=reorder(items);}}>rotate</button>
        <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,
  })['./App.tsx']!;
  expect(output).not.toMatch(/\.reconcile\(items, [^\n]*\.reasonsOnly\(/);
});

it.each([{linkFunctionSummaries:false},{hot:true}])('disables imported provenance when linking or hot replacement cannot preserve it: %j', options => {
  const output = compileModules({
    './rows.ts': `export function create(){return [{id:1,label:'one'},{id:2,label:'two'}];}
      export function reorder(rows){return [rows[1],rows[0]];}`,
    './App.tsx': `import {create,reorder} from './rows';export function App(){let items=create();
      return <main><button onClick={()=>{items=reorder(items);}}>rotate</button>
        <ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,
  },options)['./App.tsx']!;
  expect(output).not.toMatch(/\.reconcile\(items, [^\n]*\.reasonsOnly\(/);
});

it('preserves a published selection change caused by host creation during a structural frame', async () => {
  customElements.define('md-imported-select', class extends HTMLElement {
    constructor() { super(); document.getElementById('choose')?.click(); }
  });
  const { App } = await load({
    './rows.ts': `export function create(){return [{id:1,label:'one'},{id:2,label:'two'}];}
      export function append(rows){return [rows[0],rows[1],{id:3,label:'three'}];}`,
    './App.tsx': `import {create,append} from './rows';export function App(){let items=create();let selected=0;
      return <main><button id="choose" onClick={()=>{selected=1;}}>choose</button>
        <button id="append" onClick={()=>{items=append(items);}}>append</button>
        <ul>{items.map(item=><md-imported-select key={item.id} class={selected===item.id?'danger':''}>{item.label}</md-imported-select>)}</ul></main>;}`,
  }, 'host-selection');
  setScheduler(run=>run()); document.body.append(App('HostSelection',null));
  const original = [...document.querySelectorAll('md-imported-select')];
  document.getElementById('append')!.click();
  const rows = [...document.querySelectorAll('md-imported-select')];
  expect(rows).toHaveLength(3);
  expect(rows.slice(0,2)).toEqual(original);
  expect(rows.map(row=>row.textContent)).toEqual(['one','two','three']);
  expect(rows.map(row=>row.className)).toEqual(['danger','','']);
});

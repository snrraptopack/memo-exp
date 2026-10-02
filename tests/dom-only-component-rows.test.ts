import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { _internals, createListRegion, mount, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/dom-only-component-rows');
const domOnly = /,\s*false,\s*false,\s*true\s*\)/;
const row = `function Row({item,remove}){return <li><span>{item.label}</span>
  <button onClick={()=>remove(item.id)}>remove</button></li>;}`;
const app = `export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}];
  const remove=id=>{items=items.filter(item=>item.id!==id);};
  return <main><button class="reverse" onClick={()=>{items.reverse();}}>reverse</button>
    <button class="clear" onClick={()=>{items=[];}}>clear</button>
    <button class="fill" onClick={()=>{items=[{id:4,label:'four'},{id:5,label:'five'},{id:6,label:'six'}];}}>fill</button>
    <button class="pop" onClick={()=>{items.pop();}}>pop</button>
    <ul>{items.map(item=><Row key={item.id} item={item} remove={remove}/>)}</ul></main>;}`;
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable(); resetScheduler(); document.body.replaceChildren();
  delete globalThis.__domOnlyMounts; delete globalThis.__domOnlyCleanups;
});

it.each(['before', 'after', 'linked', 'reexport'].flatMap(kind => [false, true].map(deferred => ({kind, deferred}))))(
  'retains DOM-only component ownership (kind=$kind, deferred=$deferred)', async ({kind, deferred}) => {
    const linked = kind === 'linked' || kind === 'reexport';
    const modules = linked ? {
      './row.tsx': 'export ' + row,
      './barrel.ts': "import {Row} from './row';export {Row};",
      './app.tsx': `import {Row} from './${kind === 'linked' ? 'row' : 'barrel'}';${app}`,
    } : { './app.tsx': kind === 'before' ? row + app : app + row };
    const {output, metadata} = compileModulesDetailed(modules);
    expect(output['./app.tsx']).toMatch(domOnly);
    if (linked) expect(metadata['./row.tsx']!.componentExports.find(value => value.exported === 'Row'))
      .toMatchObject({listLightweight: true, listResourceFree: true});
    const name = `${kind}-${deferred}`, target = join(directory, name);
    mkdirSync(target, {recursive: true});
    for (const [file, code] of Object.entries(output)) writeFileSync(join(target, file.slice(2).replace(/\.tsx$/, '.ts')), code);
    const pending: Array<() => void> = [];
    setScheduler(run => { if (deferred) pending.push(run); else run(); });
    const flush = () => { while (pending.length) pending.shift()!(); };
    const specifier = `./fixtures/out/dom-only-component-rows/${name}/app.ts`;
    const {App} = await import(specifier); document.body.append(App('App', null));
    const rows = [...document.querySelectorAll('li')];
    const click = (selector: string) => { document.querySelector<HTMLButtonElement>(selector)!.click(); flush(); };
    click('.reverse'); expect([...document.querySelectorAll('li')]).toEqual([...rows].reverse());
    click('li button'); expect([...document.querySelectorAll('li')]).toEqual([rows[1], rows[0]]);
    click('.clear'); expect(document.querySelectorAll('li')).toHaveLength(0);
    click('.fill'); const filled = [...document.querySelectorAll('li')];
    expect(filled.map(node => node.querySelector('span')!.textContent)).toEqual(['four', 'five', 'six']);
    click('.pop'); expect([...document.querySelectorAll('li')]).toEqual(filled.slice(0, 2));
    click('li button'); expect([...document.querySelectorAll('li')]).toEqual([filled[1]]);
    expect([..._internals().registry.keys()].filter(id => id.includes('/Row['))).toEqual([]);
  },
);

it.each([
  ['ref', '<li ref={node=>()=>{}}>{item.label}</li>'],
  ['spread', '<li {...item.attrs}>{item.label}</li>'],
  ['child', '<li><Child/></li>'],
  ['nested branch', '<li>{item.id ? <b>{item.label}</b> : <i>empty</i>}</li>'],
  ['render call', '<li>{format(item.label)}</li>'],
  ['render slot', '<li>{render}</li>'],
])('retains conservative ownership for %s', (_name, jsx) => {
  const {metadata} = compileModulesDetailed({
    './row.tsx': `function format(value){return value;}function Child(){return <b/>;}
      export function Row({item,render}){return ${jsx};}`,
    './app.tsx': `import {Row} from './row';export function App(){let items=[{id:1,label:'one',attrs:{}}];
        return <ul>{items.map(item=><Row key={item.id} item={item}${jsx.includes('{render}') ? ' render={<b>child</b>}' : ''}/>)}</ul>;}`,
  });
  expect(metadata['./row.tsx']!.componentExports.find(value => value.exported === 'Row'))
    .not.toHaveProperty('listResourceFree', true);
});

it('preserves aliased component identity when the application precedes its barrels', () => {
  const {output, metadata} = compileModulesDetailed({
    './app.tsx': `import {Alias as Row} from './outer';${app}`,
    './outer.ts': "import {Alias} from './inner';export {Alias};",
    './inner.ts': "import {Row as Alias} from './row';export {Alias};",
    './row.tsx': 'export ' + row,
  });
  expect(output['./app.tsx']).toMatch(domOnly);
  for (const file of ['./outer.ts', './inner.ts']) expect(metadata[file]!.componentExports)
    .toContainEqual(expect.objectContaining({exported: 'Alias', listLightweight: true, listResourceFree: true}));
});

it('keeps development row ownership', () => {
  const {output, metadata} = compileModulesDetailed({'./row.tsx': 'export ' + row,
    './app.tsx': `import {Row} from './row';${app}`}, {hot: true});
  expect(output['./app.tsx']).not.toMatch(domOnly);
  expect(metadata['./row.tsx']!.componentExports[0]).not.toHaveProperty('listResourceFree', true);
});

it('mounts a root exported through an alias from its declaring module', async () => {
  const {output, applicationRoot} = compileModulesDetailed({
    './main.ts': "import {mount} from '@memoized-dom/runtime';import {Alias} from './barrel';mount('mount-root',Alias);",
    './barrel.ts': "import {App} from './app';export {App as Alias};",
    './app.tsx': row + app,
  });
  expect(applicationRoot).toMatchObject({moduleId: './app.tsx', local: 'App', rootId: 'App'});
  expect(output['./app.tsx']).toContain('registerRootFactory');
  const target = join(directory, 'root-alias'); mkdirSync(target, {recursive: true});
  for (const [file, code] of Object.entries(output)) writeFileSync(join(target, file.slice(2).replace(/\.tsx$/, '.ts')), code);
  const host = document.createElement('div'); host.id = 'mount-root'; document.body.append(host);
  setScheduler(run => run());
  const specifier = './fixtures/out/dom-only-component-rows/root-alias/barrel.ts';
  const {Alias} = await import(specifier);
  const application = mount('mount-root', Alias);
  try {
    expect(host.querySelectorAll('li')).toHaveLength(3);
    host.querySelector<HTMLButtonElement>('.pop')!.click();
    expect(host.querySelectorAll('li')).toHaveLength(2);
  } finally { application.unmount(); }
  expect(host.childNodes).toHaveLength(0);
});

it.each(['$effect(()=>()=>{});', '$cleanup(()=>{});'])('keeps lifecycle ownership for %s', lifecycle => {
  const {metadata, output} = compileModulesDetailed({
    './row.tsx': `export function Row({item,remove}){${lifecycle}return <li>{item.label}</li>;}`,
    './app.tsx': `import {Row} from './row';${app}`,
  });
  expect(metadata['./row.tsx']!.componentExports[0]).not.toHaveProperty('listResourceFree', true);
  expect(output['./app.tsx']).not.toMatch(domOnly);
});

it('keeps lightweight ref disposal during linked row removal', async () => {
  const result = compileModulesDetailed({
    './row.tsx': `export function Row({item}){return <li ref={node=>{
      globalThis.__domOnlyMounts++;return ()=>{globalThis.__domOnlyCleanups++;};
    }}>{item.id}</li>;}`,
    './app.tsx': `import {Row} from './row';export function App(){let items=[{id:1},{id:2},{id:3}];
      return <main><button onClick={()=>{items.pop();}}>pop</button>
        <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul></main>;}`,
  });
  expect(result.metadata['./row.tsx']!.componentExports[0]).toMatchObject({listLightweight: true});
  expect(result.metadata['./row.tsx']!.componentExports[0]).not.toHaveProperty('listResourceFree', true);
  const target = join(directory, 'refs'); mkdirSync(target, {recursive: true});
  for (const [file, code] of Object.entries(result.output)) writeFileSync(join(target, file.slice(2).replace(/\.tsx$/, '.ts')), code);
  globalThis.__domOnlyMounts = 0; globalThis.__domOnlyCleanups = 0; setScheduler(run => run());
  const specifier = './fixtures/out/dom-only-component-rows/refs/app.ts';
  const {App} = await import(specifier); document.body.append(App('App', null));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(globalThis.__domOnlyMounts).toBe(3); document.querySelector<HTMLButtonElement>('button')!.click();
  expect(globalThis.__domOnlyCleanups).toBe(1); unregister('App');
  expect(globalThis.__domOnlyCleanups).toBe(3); expect(document.querySelectorAll('li')).toHaveLength(0);
});

it.each([false, true])('finishes DOM-only suffix cleanup after a range error (partial=%s)', partial => {
  const host = document.createElement('ul'); document.body.append(host);
  const region = createListRegion(host, 'range-error', (item: number) => {
    const a = document.createElement('li'), b = document.createTextNode(String(item));
    return {nodes: [a, b], entities: []};
  }, undefined, false, false, true);
  region.reconcile([1, 2, 3]); const nodes = [...host.childNodes];
  const original = document.createRange, failure = new Error('range');
  document.createRange = () => {
    const range = original.call(document), remove = range.deleteContents.bind(range);
    range.deleteContents = () => { if (partial) remove(); throw failure; }; return range;
  };
  try { expect(() => region.reconcile([1])).toThrow(failure); }
  finally { document.createRange = original; }
  expect([...host.childNodes]).toEqual([nodes[0], nodes[1], nodes[2], nodes.at(-1)]);
  expect(region.size()).toBe(1); region.reconcile([1, 4]); expect(region.size()).toBe(2);
  region.dispose(); expect(host.childNodes).toHaveLength(0);
});

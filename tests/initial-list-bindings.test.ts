import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, registeredIds, unregisterSubtree, resetScheduler, setScheduler,
  type MountedApplication } from '@memoized-dom/runtime/testing';

const directory=join(import.meta.dirname,'fixtures/out/initial-lists');
let app:MountedApplication|undefined;
afterEach(()=>{
  app?.unmount();app=undefined;
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();vi.restoreAllMocks();document.body.replaceChildren();
});
function compile(source:string) {
  const runtimePath='@memoized-dom/runtime/testing';
  return compileModulesDetailed({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source},{runtimePath});
}
async function mount(name:string,source:string) {
  const result=compile(source);expect(result.initialRender.kind).toBe('bindings');
  const html=emitInitialHtml(result.initialRender);expect(html).not.toBeNull();
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,`${name}.ts`),result.initialBrowserOutput!['./App.tsx']!);
  document.body.innerHTML=`<div id="root">${html}</div>`;
  const original=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement'), text=vi.spyOn(document,'createTextNode');
  const specifier=`./fixtures/out/initial-lists/${name}.ts`;const {App}=await import(specifier);
  setScheduler(run=>run());app=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect(text).toHaveBeenCalledTimes(html!.match(/<!--mmd:empty-->/g)?.length??0);
  expect([...document.querySelectorAll('*')]).toEqual(original);
  create.mockRestore();text.mockRestore();return result;
}
function click(selector:string) {document.querySelector<HTMLButtonElement>(selector)!.click();}
function rows() {return [...document.querySelectorAll('li')];}

it.each(['key={item.id}','key={index}'])('binds initial rows and preserves the %s reconciliation contract',async(key)=>{
  const result=await mount(key.includes('item')?'keyed':'positional',`export function App(){
    let items=[{id:1,label:'one'},{id:2,label:'two'}];return <main><h1>Static outside list</h1>
    <button class="reverse" onClick={()=>{items=[...items].reverse();}}>Reverse</button>
    <button class="replace" onClick={()=>{items=items.map(item=>({...item,label:item.label+'!'}));}}>Replace</button>
    <button class="append" onClick={()=>{items=[...items,{id:3,label:'three'}];}}>Append</button>
    <button class="clear" onClick={()=>{items=[];}}>Clear</button><ul>
    {items.map((item,index)=><li ${key} title={item.label}><b>Row: </b><span>{index}:{item.label}</span></li>)}</ul>
    <p>After the list</p></main>;}`);
  const original=rows(),main=document.querySelector('main');
  expect(result.initialBrowserOutput!['./App.tsx']).not.toContain('Static outside list');
  click('.reverse');expect(rows().map(row=>row.textContent)).toEqual(['Row: 0:two','Row: 1:one']);
  expect(rows()).toEqual(key.includes('item')?[original[1],original[0]]:original);
  click('.replace');expect(rows().map(row=>row.getAttribute('title'))).toEqual(['two!','one!']);
  expect(rows()).toEqual(key.includes('item')?[original[1],original[0]]:original);
  click('.append');const added=rows()[2]!;expect(added.textContent).toBe('Row: 2:three');
  expect(added.querySelector('b')!.textContent).toBe('Row: ');expect(added.getAttribute('title')).toBe('three');
  click('.replace');expect(rows()[2]).toBe(added);expect(added.textContent).toBe('Row: 2:three!');
  click('.clear');expect(rows()).toEqual([]);click('.append');expect(rows()[0]!.textContent).toBe('Row: 0:three');
  expect(document.querySelector('main')).toBe(main);app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

it('retains default object identity and delegates initial and later row events',async()=>{
  await mount('identity',`export function App(){let items=[{label:'one'},{label:'two'}];let selected='';return <main>
    <button class="reverse" onClick={()=>{items=[...items].reverse();}}>Reverse</button>
    <button class="append" onClick={()=>{items=[...items,{label:'three'}];}}>Append</button>
    {items.map(item=><li><button onClick={()=>{selected=item.label;}}>{item.label}</button></li>)}<p>{selected}</p></main>;}`);
  const initial=rows();click('li button');expect(document.querySelector('p')!.textContent).toBe('one');
  click('.reverse');expect(rows()).toEqual([initial[1],initial[0]]);
  click('li button');expect(document.querySelector('p')!.textContent).toBe('two');
  click('.append');rows()[2]!.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('p')!.textContent).toBe('three');
});

it('keeps module readers registered and live after initial binding',async()=>{
  await mount('module',`let suffix='!';export function App(){let items=['one','two'];return <main>
    <button onClick={()=>{suffix+='!';}}>Next</button>{items.map(item=><li>{item}{suffix}</li>)}</main>;}`);
  const initial=rows();click('button');expect(rows()).toEqual(initial);
  expect(rows().map(row=>row.textContent)).toEqual(['one!!','two!!']);
});

it('binds empty row text and addresses following independent list ranges',async()=>{
  await mount('empty-text',`export function App(){let first=['','one'];let second=['two'];let n=0;return <main>
    <button onClick={()=>{first=['new',''];second=['changed'];n++;}}>Next</button>
    {first.map((item,index)=><li key={index}>{item}</li>)}<p>{n}</p>
    {second.map(item=><li>{item}</li>)}<span>{n}</span></main>;}`);
  const initial=rows();expect(initial.map(row=>row.textContent)).toEqual(['','one','two']);click('button');
  expect(rows().slice(0,2)).toEqual(initial.slice(0,2));expect(rows().map(row=>row.textContent)).toEqual(['new','','changed']);
  expect(document.querySelector('p')!.textContent).toBe('1');expect(document.querySelector('span')!.textContent).toBe('1');
});

it.each([
  `let items=[];`, `let items=getItems();`,
])('falls back for an unproved initial source: %s',setup=>{
  const result=compile(`function getItems(){return ['one'];}export function App(){${setup}return <main>
    <button onClick={()=>{items=['two'];}}>Replace</button>{items.map(item=><li>{item}</li>)}</main>;}`);
  expect(result.initialBrowserOutput).toBeUndefined();
});

it.each([
  `<li>{show?<b>{item}</b>:null}</li>`, `<li ref={node=>{}}>{item}</li>`,
  `<li>{Date.now()}</li>`, `<li {...{title:item}}>{item}</li>`,
])('falls back for unproved row semantics: %s',row=>{
  const result=compile(`export function App(){let items=['one'];let show=true;return <main>
    <button onClick={()=>{items=['two'];}}>Replace</button>{items.map(item=>${row})}</main>;}`);
  expect(result.initialBrowserOutput).toBeUndefined();
});

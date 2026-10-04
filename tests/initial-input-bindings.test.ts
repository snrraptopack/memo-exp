import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mount, mountInitial, registeredIds, unregisterSubtree, resetScheduler, setScheduler,
  type MountedApplication } from '@memoized-dom/runtime/testing';

const directory=join(import.meta.dirname,'fixtures/out/initial-inputs');
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
async function start(name:string,source:string,initial=true) {
  const result=compile(source);
  expect(result.initialRender.kind).toBe('bindings');const html=emitInitialHtml(result.initialRender);expect(html).not.toBeNull();
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,`${name}.ts`),(initial?result.initialBrowserOutput!:result.output)['./App.tsx']!);
  document.body.innerHTML=`<div id="root">${initial?html:''}</div>`;
  const original=[...document.querySelectorAll('*')],create=vi.spyOn(document,'createElement');
  const specifier=`./fixtures/out/initial-inputs/${name}.ts`;const {App}=await import(specifier);
  setScheduler(run=>run());app=initial?mountInitial('root',App):mount('root',App);
  if(initial){expect(create).not.toHaveBeenCalled();expect([...document.querySelectorAll('*')]).toEqual(original);}
  create.mockRestore();return result;
}
function input(){return document.querySelector<HTMLInputElement>('input')!;}
function click(selector:string){document.querySelector<HTMLButtonElement>(selector)!.click();}
function type(value:string){input().value=value;input().dispatchEvent(new Event('input',{bubbles:true}));}

it.each([false,true])('supports the positional todo graph from a nonempty or empty source (empty=%s)',async empty=>{
  const result=await start(empty?'empty-todo':'todo',`export function App(){let items=${empty?'[]':"['first','second']"};let temp='';return <main>
    <h1>Static todo surrounding content</h1><input placeholder="enter here" value={temp} onInput={e=>{temp=e.target.value;}}/>
    <ul>{items.map((item,index)=><li key={index}>{index}-{item}</li>)}</ul>
    <button class="add" onClick={()=>{if(!temp.trim())return;items=[...items,temp];temp='';}}>Add todo</button>
    <button class="clear" onClick={()=>{items=[];}}>Clear</button><p>{temp}</p></main>;}`);
  expect(result.initialBrowserOutput!['./App.tsx']).toContain('bindInitialInputValue');
  expect(result.initialBrowserOutput!['./App.tsx']).not.toContain('Static todo surrounding content');
  const first=[...document.querySelectorAll('li')],field=input();expect(field.value).toBe('');expect(field.defaultValue).toBe('');
  type(' ');click('.add');expect(document.querySelectorAll('li').length).toBe(first.length);expect(field.value).toBe(' ');
  type('new');expect(document.querySelector('p')!.textContent).toBe('new');click('.add');
  expect([...document.querySelectorAll('li')].map(node=>node.textContent)).toEqual([...first.map(node=>node.textContent),`${first.length}-new`]);
  expect([...document.querySelectorAll('li')].slice(0,first.length)).toEqual(first);expect(field.value).toBe('');
  type('new');click('.add');expect(document.querySelector('li:last-child')!.textContent).toBe(`${first.length+1}-new`);
  click('.clear');type('again');click('.add');expect(document.querySelector('li')!.textContent).toBe('0-again');
  expect(input()).toBe(field);app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

it.each(['text','search','email','url','password','tel'])('matches ordinary %s input defaults and native reset',async kind=>{
  const source=String.raw`export function App(){let value=' first\nsecond ';return <main><form><input type="${kind}" value={value} onInput={e=>{value=e.target.value;}}/></form>
    <button onClick={()=>{value='changed';}}>Change</button><p>{value}</p></main>;}`;
  const snapshots:unknown[]=[];
  for(const initial of [false,true]){
    await start(`${kind}-${initial}`,source,initial);
    const field=input();snapshots.push([field.value,field.defaultValue,field.getAttribute('value')]);
    type('edited');expect(document.querySelector('p')!.textContent).toBe(field.value);
    document.querySelector('form')!.reset();snapshots.push([field.value,field.defaultValue]);
    click('button');snapshots.push([field.value,document.querySelector('p')!.textContent]);
    app!.unmount();app=undefined;
  }
  expect(snapshots.slice(0,3)).toEqual(snapshots.slice(3));
});

it.each(['0','null','false','void 0'])('preserves primitive value coercion: %s',async initial=>{
  await start(`primitive-${initial.replaceAll(' ','-')}`,`export function App(){let value=${initial};return <main>
    <input value={value} onInput={e=>{value=e.target.value;}}/><button onClick={()=>{value='next';}}>Next</button></main>;}`);
  expect(input().value).toBe(initial==='0'?'0':initial==='false'?'false':'');expect(input().defaultValue).toBe('');
  click('button');expect(input().value).toBe('next');
});

it('uses the same input factory after branch replacement',async()=>{
  await start('conditional',`export function App(){let open=true;let value='seed';return <main>
    <button onClick={()=>{open=!open;}}>Toggle</button>{open?<section><input value={value} onInput={e=>{value=e.target.value;}}/></section>:null}
    <p>{value}</p></main>;}`);
  const original=input();type('edited');click('button');expect(document.querySelector('input')).toBeNull();click('button');
  expect(input()).not.toBe(original);expect(input().value).toBe('edited');expect(input().defaultValue).toBe('');
  type('later');expect(document.querySelector('p')!.textContent).toBe('later');
});

it('binds initial input rows and initializes values in appended rows',async()=>{
  await start('rows',`export function App(){let items=[{id:1,value:'first'}];return <main>
    <button onClick={()=>{items=[...items,{id:2,value:'second'}];}}>Append</button>
    {items.map(item=><input key={item.id} value={item.value} onInput={e=>{item.value=e.target.value;}}/>)}</main>;}`);
  const first=input();expect(first.value).toBe('first');expect(first.defaultValue).toBe('');type('edited');click('button');
  const fields=[...document.querySelectorAll<HTMLInputElement>('input')];expect(fields.map(field=>field.value)).toEqual(['edited','second']);
  expect(fields[0]).toBe(first);expect(fields.map(field=>field.defaultValue)).toEqual(['','']);
});

it.each(['file','checkbox','radio','range','number','date'])('retains ordinary creation for unproved input type %s',kind=>{
  const result=compile(`export function App(){let value='';return <input type="${kind}" value={value} onInput={e=>{value=e.target.value;}}/>;}`);
  expect(result.initialBrowserOutput).toBeUndefined();
});

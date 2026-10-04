import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, registeredIds, unregisterSubtree, setScheduler, resetScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';

let app:MountedApplication|undefined;
afterEach(()=>{app?.unmount();app=undefined;for(const id of registeredIds())unregisterSubtree(id);resetScheduler();vi.restoreAllMocks();document.body.replaceChildren();});
function compile(source:string,modules:Record<string,string>={}) {
  const runtimePath='@memoized-dom/runtime/testing';
  return compileModulesDetailed({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source,...modules},{runtimePath});
}
async function bind(name:string,source:string,modules:Record<string,string>={}) {
  const result=compile(source,modules);
  expect(result.initialRender.kind).toBe('bindings');expect(result.initialBrowserOutput).toBeDefined();
  const directory=join(import.meta.dirname,'fixtures/out/initial-composition',name);mkdirSync(directory,{recursive:true});
  for(const [id,code] of Object.entries(result.initialBrowserOutput!))writeFileSync(join(directory,id),code);
  document.body.innerHTML=`<div id="root">${emitInitialHtml(result.initialRender)}</div>`;
  const original=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement'),text=vi.spyOn(document,'createTextNode');
  const {App}=await import(/* @vite-ignore */ pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());app=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect([...document.querySelectorAll('*')]).toEqual(original);
  expect(text.mock.calls.length).toBeLessThanOrEqual(emitInitialHtml(result.initialRender)!.match(/<!--mmd:empty-->/g)?.length??0);
  create.mockRestore();text.mockRestore();return result;
}
function click(selector:string) {document.querySelector<HTMLButtonElement>(selector)!.click();}

it('keeps repeated static/live props and empty text distinct while sharing their factory',async()=>{
  const result=await bind('repeated',`function Label({value='fallback'}){return <strong title={value}>{value}</strong>;}
    export function App(){let n=0;return <main><h1>Static surroundings</h1><button onClick={()=>n++}>Add</button>
      <Label value=""/><Label value={n}/><Label/></main>;}`);
  const labels=[...document.querySelectorAll('strong')];
  expect(labels.map(node=>node.textContent)).toEqual(['','0','fallback']);
  click('button');expect(labels.map(node=>node.textContent)).toEqual(['','1','fallback']);
  expect(labels.map(node=>node.getAttribute('title'))).toEqual(['','1','fallback']);
  expect([...document.querySelectorAll('strong')]).toEqual(labels);
  expect(result.initialBrowserOutput!['./App.tsx']).not.toMatch(/createElement|createTextNode|materializeMarkup|Static surroundings/);
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

it('binds nested imported aliases and retains derived prop updates',async()=>{
  const result=await bind('nested',`import {Counter} from './Counter';export function App(){return <main><Counter offset={2}/><Counter offset={10}/></main>;}`,{
    './Counter.tsx':`import {Value as Output} from './Value';export function Counter({offset}){let n=0;const doubled=n*2;const value=doubled+offset;
      return <section><button onClick={()=>n++}>Add</button><Output value={value}/></section>;}`,
    './Value.tsx':`export const Value=(props)=> <strong>{props.value}</strong>;`,
  });
  const buttons=[...document.querySelectorAll('button')],labels=[...document.querySelectorAll('strong')];
  expect(labels.map(node=>node.textContent)).toEqual(['2','10']);buttons[0]!.click();
  expect(labels.map(node=>node.textContent)).toEqual(['4','10']);buttons[1]!.click();
  expect(labels.map(node=>node.textContent)).toEqual(['4','12']);
  for(const id of ['./App.tsx','./Counter.tsx','./Value.tsx'])expect(result.initialBrowserOutput![id]).not.toMatch(/createElement|createTextNode|materializeMarkup/);
});

it('retains captured callback writes and sends coherent final props to children',async()=>{
  await bind('callbacks',`function Action({run}){return <button onClick={run}>Change</button>;}
    function Value({text}){return <p>{text}</p>;}
    export function App(){let n=0;let label='before';function change(){n++;label='after';}
      return <main><Action run={change}/><Value text={label+':'+n}/></main>;}`);
  const value=document.querySelector('p');click('button');expect(value!.textContent).toBe('after:1');
  click('button');expect(value!.textContent).toBe('after:2');expect(document.querySelector('p')).toBe(value);
});

it('retains imported module writes and object alias mutation after composition binding',async()=>{
  await bind('module',`import {name,change} from './state';import {Action} from './Action';
    function Value({text}){return <p>{text}</p>;}
    export function App(){const person={name:'Ada'};const alias=person;function rename(){alias.name='Grace';}
      return <main><h1>{name}</h1><Action run={change}/><Action run={rename}/><Value text={person.name}/></main>;}`,{
    './state.ts':`export let name='Ada';export function change(){name='Grace';}`,
    './Action.tsx':`export function Action({run}){return <button onClick={run}>Change</button>;}`,
  });
  const buttons=[...document.querySelectorAll('button')];buttons[0]!.click();
  expect(document.querySelector('h1')!.textContent).toBe('Grace');buttons[1]!.click();
  expect(document.querySelector('p')!.textContent).toBe('Grace');
});

it('binds structural regions relative to each composed instance and creates later rows',async()=>{
  await bind('lists',`function Todos({suffix}){let items=['one','two'];return <section><button onClick={()=>{items=[...items,'new'];}}>Add</button>
    <ul>{items.map((item,index)=><li key={index}>{item}{suffix}</li>)}</ul><p>After list</p></section>;}
    export function App(){return <main><Todos suffix="!"/><Todos suffix="?"/></main>;}`);
  const lists=[...document.querySelectorAll('ul')],first=[...lists[0]!.children],second=[...lists[1]!.children];
  click('button');expect([...lists[0]!.children].map(node=>node.textContent)).toEqual(['one!','two!','new!']);
  expect([...lists[0]!.children].slice(0,2)).toEqual(first);expect([...lists[1]!.children]).toEqual(second);
});

it.each([
  `function Label({value}){return <strong>{value}</strong>;}export function App(){let show=false;return <main><button onClick={()=>{show=true;}}>Show</button><Label value="one"/>{show&&<Label value="two"/>}</main>;}`,
  `function Label(){return <strong>Value</strong>;}export function App(){const escaped=Label;return <main><Label/><button onClick={()=>escaped()}>Call</button></main>;}`,
])('retains ordinary creation for a factory with future or escaped uses',source=>{
  const result=compile(source);expect(result.initialBrowserOutput).toBeUndefined();
  expect(result.output['./App.tsx']).toMatch(/materializeMarkup|createElement/);
});

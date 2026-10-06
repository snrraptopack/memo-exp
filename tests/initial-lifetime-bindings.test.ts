import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileModulesDetailed,emitInitialHtml} from '@memoized-dom/compiler';
import {mountInitial,registeredIds,unregisterSubtree,setScheduler,resetScheduler,type MountedApplication} from '@memoized-dom/runtime/testing';

let app:MountedApplication|undefined;
afterEach(()=>{app?.unmount();app=undefined;for(const id of registeredIds())unregisterSubtree(id);resetScheduler();vi.restoreAllMocks();document.body.replaceChildren();});
function compile(source:string){
  const runtimePath='@memoized-dom/runtime/testing';
  return compileModulesDetailed({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source},{runtimePath,initialContent:true});
}
async function bind(name:string,source:string){
  const result=compile(source);expect(result.initialRender.kind).toBe('bindings');
  const directory=join(import.meta.dirname,'fixtures/out/initial-lifetime',name);mkdirSync(directory,{recursive:true});
  for(const [id,code] of Object.entries(result.output))writeFileSync(join(directory,id),code);
  document.body.innerHTML=`<div id="root">${emitInitialHtml(result.initialRender)}</div>`;
  const nodes=[...document.querySelectorAll('*')];const create=vi.spyOn(document,'createElement');
  const {App}=await import(/* @vite-ignore */pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());app=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect([...document.querySelectorAll('*')]).toEqual(nodes);
  create.mockRestore();return result;
}

it('binds refs and effects without recreating static ancestors, preserving rerun and cleanup',async()=>{
  const result=await bind('effect-ref',`function Panel(){let n=0;let node:HTMLInputElement|null=null;
    $effect(()=>{if(node)node.title='count:'+n;return ()=>{if(node)node.dataset.cleaned=''+n;};});
    return <section><input ref={node}/><button onClick={()=>n++}>{n}</button></section>;}
    export function App(){return <main><h1>Retained</h1><Panel/></main>;}`);
  expect(result.initialRender).toMatchObject({owners:[{component:'Panel',features:['effect','ref']}]});
  const input=document.querySelector('input')!,heading=document.querySelector('h1')!;
  expect(input.title).toBe('count:0');document.querySelector('button')!.click();
  expect(input.title).toBe('count:1');expect(input.dataset.cleaned).toBe('1');
  expect(document.querySelector('input')).toBe(input);expect(document.querySelector('h1')).toBe(heading);
  app!.unmount();expect(input.dataset.cleaned).toBe('1');expect(document.querySelector('main')).toBeNull();
});

it('retains a cleanup-only owner even without events or dynamic text',async()=>{
  const result=await bind('cleanup-only',`export function App(){let node:HTMLElement|null=null;
    $cleanup(()=>{document.body.dataset.initialCleanup='yes';});return <main ref={node}><h1>Static</h1></main>;}`);
  const main=document.querySelector('main')!;
  expect(result.initialRender).toMatchObject({owners:[{component:'App',features:['cleanup','ref']}]});
  expect(main.isConnected).toBe(true);expect(document.body.dataset.initialCleanup).toBeUndefined();
  app!.unmount();expect(document.body.dataset.initialCleanup).toBe('yes');delete document.body.dataset.initialCleanup;
});

it.each([
  `function $effect(callback){callback();}export function App(){$effect(()=>{});return <main/>;}`,
  `function work(){}export function App(){$effect(work);return <main/>;}`,
])('keeps unproved lifecycle setup on ordinary creation: %s',source=>{
  expect(compile(source).initialRender.kind).toBe('browser');
});

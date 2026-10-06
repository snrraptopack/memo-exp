import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileModulesDetailed,emitInitialHtml} from '@memoized-dom/compiler';
import {mountInitial,registeredIds,unregisterSubtree,setScheduler,resetScheduler,type MountedApplication} from '@memoized-dom/runtime/testing';

let application:MountedApplication|undefined;
afterEach(()=>{
  application?.unmount();application=undefined;
  for(const id of registeredIds())unregisterSubtree(id);
  resetScheduler();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();
});
const shell=`export function Shell({children}){return <section><h2>Before</h2>{children}<footer>After</footer></section>;}`;
async function bind(name:string,source:string,modules:Record<string,string>={}) {
  const runtimePath='@memoized-dom/runtime/testing';
  const result=compileModulesDetailed({
    './main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source,'./Shell.tsx':shell,...modules,
  },{initialContent:true,runtimePath});
  expect(result.initialContent).toBe(true);expect(result.initialRender.kind).toBe('bindings');
  const html=emitInitialHtml(result.initialRender);expect(html).not.toBeNull();
  const directory=join(import.meta.dirname,'fixtures/out/initial-structural-children',name);
  mkdirSync(directory,{recursive:true});
  for(const [id,code] of Object.entries(result.output))writeFileSync(join(directory,id),code);
  document.body.innerHTML=`<div id="root">${html}</div>`;
  const elements=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement'),text=vi.spyOn(document,'createTextNode');
  const {App}=await import(/* @vite-ignore */ pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());application=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect([...document.querySelectorAll('*')]).toEqual(elements);
  expect(text.mock.calls.length).toBeLessThanOrEqual(html!.match(/<!--mmd:empty-->/g)?.length??0);
  create.mockRestore();text.mockRestore();return result;
}
function click(selector:string){document.querySelector<HTMLButtonElement>(selector)!.click();}

it.each([
  `<Shell>{open&&<ul>{items.map(item=><li key={item.id}>{item.label}</li>)}</ul>}</Shell>`,
  `{open&&<Shell><b>Later</b></Shell>}`,
  `<Shell>{user?.rows?.map(row=><li key={row.id}>{row.label}</li>)}</Shell>`,
])('retains general creation for unproved nested or recreated slot extents: %s',content=>{
  const result=compileModulesDetailed({
    './main.ts':`import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    './App.tsx':`import {Shell} from './Shell';export function App(){const user=$fetch('/api/user');let open=true;let items=[{id:1,label:'one'}];
      return <main><button onClick={()=>open=!open}>Toggle</button>${content}</main>;}`,
    './Shell.tsx':shell,
  },{initialContent:true});
  expect(result.initialContent).toBe(false);expect(result.output['./App.tsx']).toContain('createElement');
});

it.each([false,true])('binds conditional children and creates later branches (open=%s)',async open=>{
  const result=await bind(`conditional-${open}`,`import {Shell} from './Shell';export function App(){let open=${open};let n=1;
    return <main><button class="toggle" onClick={()=>open=!open}>Toggle</button><button class="next" onClick={()=>n++}>Next</button>
      <Shell>{open?<b title={'n'+n}>{n}</b>:<i>Closed</i>}</Shell><p>{n}</p></main>;}`);
  const section=document.querySelector('section'),heading=document.querySelector('h2'),initial=document.querySelector(open?'b':'i');
  click('.next');expect(document.querySelector('p')!.textContent).toBe('2');
  expect(document.querySelector(open?'b':'i')).toBe(initial);
  if(open)expect(initial!.textContent).toBe('2');
  click('.toggle');expect(document.querySelector(open?'b':'i')).toBeNull();
  click('.toggle');expect(document.querySelector(open?'b':'i')).not.toBe(initial);
  if(open)expect(document.querySelector('b')!.getAttribute('title')).toBe('n2');
  expect(document.querySelector('section')).toBe(section);expect(document.querySelector('h2')).toBe(heading);
  expect(result.output['./Shell.tsx']).not.toMatch(/createElement|createTextNode|materializeMarkup/);
  expect(result.output['./App.tsx']).toContain('createCondRegion');
});

it.each([0,2])('binds keyed list children with %i initial rows and retains identity',async count=>{
  const items=Array.from({length:count},(_,id)=>({id,label:'row'+id}));
  const result=await bind(`list-${count}`,`import {Shell} from './Shell';export function App(){let items=${JSON.stringify(items)};let next=${count};let selected=-1;
    return <main><button class="append" onClick={()=>items=[...items,{id:next++,label:'new'}]}>Append</button>
      <button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
      <button class="rename" onClick={()=>items=items.map(item=>({...item,label:item.label+'!'}))}>Rename</button>
      <button class="remove" onClick={()=>items=items.filter(item=>item.id!==selected)}>Remove</button>
      <button class="clear" onClick={()=>items=[]}>Clear</button>
      <Shell>{items.map((item,index)=><li key={item.id} class={selected===item.id?'active':''} onClick={()=>selected=item.id}>{index}:{item.label}</li>)}</Shell>
      <p>{selected}</p></main>;}`);
  const section=document.querySelector('section'),footer=document.querySelector('footer');
  click('.append');const rows=[...document.querySelectorAll('li')];expect(rows).toHaveLength(count+1);
  rows[0]!.click();expect(rows[0]!.className).toBe('active');
  click('.reverse');expect([...document.querySelectorAll('li')]).toEqual(rows.toReversed());
  expect([...document.querySelectorAll('li')].map(node=>node.textContent)).toEqual(rows.toReversed().map((node,index)=>index+':'+(index===0?'new':'row'+(count-index))));
  click('.rename');expect([...document.querySelectorAll('li')]).toEqual(rows.toReversed());
  expect([...document.querySelectorAll('li')].every(node=>node.textContent!.endsWith('!'))).toBe(true);
  click('.remove');expect(document.querySelectorAll('li')).toHaveLength(count);expect(rows[0]!.isConnected).toBe(false);
  click('.clear');click('.append');expect(document.querySelectorAll('li')).toHaveLength(1);
  expect(document.querySelector('section')).toBe(section);expect(document.querySelector('footer')).toBe(footer);
  expect(result.output['./Shell.tsx']).not.toMatch(/createElement|createTextNode|materializeMarkup/);
});

it.each(['owner','module'])('updates repeated conditional/list slots through forwarding from %s state',async placement=>{
  const declarations=`let open=true;let n=1;let items=[{id:1,label:'one'},{id:2,label:'two'}];`;
  const result=await bind(`repeated-${placement}`,`import {Shell} from './Shell';${placement==='module'?declarations:''}
    export function App(){${placement==='owner'?declarations:''}return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="toggle" onClick={()=>open=!open}>Toggle</button>
      <button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
      <Shell>{open&&<b>{n}</b>}{items.map(item=><li key={item.id}>{item.label}:{n}</li>)}</Shell></main>;}`,{
    './Shell.tsx':`import {Frame} from './Frame';export function Shell({children}){return <section><h2>Before</h2>{children}<Frame>{children}</Frame></section>;}`,
    './Frame.tsx':`export function Frame({children}){return <aside><i>Prefix</i><em>Second prefix</em>{children}<footer>After</footer></aside>;}`,
  });
  const rows=[...document.querySelectorAll('li')];click('.next');
  expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(['2','2']);
  expect(rows.map(node=>node.textContent)).toEqual(['one:2','two:2','one:2','two:2']);
  click('.reverse');expect([...document.querySelectorAll('li')]).toEqual([rows[1],rows[0],rows[3],rows[2]]);
  click('.toggle');expect(document.querySelectorAll('b')).toHaveLength(0);
  click('.toggle');expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(['2','2']);
  application!.unmount();application=undefined;expect(registeredIds()).toEqual([]);
  for(const id of ['./Shell.tsx','./Frame.tsx'])expect(result.output[id]).not.toMatch(/createElement|createTextNode|materializeMarkup/);
});

it('keeps child component state, refs and cleanup across conditional recreation',async()=>{
  const log:string[]=[];vi.stubGlobal('__slotLifetime',log);
  await bind('conditional-lifetime',`import {Shell} from './Shell';import {Counter} from './Counter';
    export function App(){let open=true;return <main><button class="toggle" onClick={()=>open=!open}>Toggle</button><Shell>{open&&<Counter/>}</Shell></main>;}`,{
    './Counter.tsx':`export function Counter(){let n=0;let ref=null;
      $effect(()=>{globalThis.__slotLifetime.push(ref?.isConnected?'mount':'detached');return ()=>globalThis.__slotLifetime.push('dispose');});
      return <button class="counter" ref={ref} onClick={()=>n++}>{n}</button>;}`,
  });
  const initial=document.querySelector('.counter');expect(log).toEqual(['mount']);click('.counter');expect(initial!.textContent).toBe('1');
  click('.toggle');expect(log).toEqual(['mount','dispose']);expect(initial!.isConnected).toBe(false);
  click('.toggle');expect(document.querySelector('.counter')).not.toBe(initial);expect(document.querySelector('.counter')!.textContent).toBe('0');
  expect(log).toEqual(['mount','dispose','mount']);application!.unmount();application=undefined;
  expect(log).toEqual(['mount','dispose','mount','dispose']);expect(registeredIds()).toEqual([]);
});

it.each(['conditional','list'])('routes external module writes to every repeated %s slot',async kind=>{
  await bind(`external-${kind}`,`import {Shell} from './Shell';import {Control} from './Control';import {open,n,items} from './state';
    export function App(){return <main><Control/><Shell>
      ${kind==='conditional'?'{open&&<b>{n}</b>}':'{items.map(item=><li key={item.id}>{item.label}:{n}</li>)}'}
    </Shell></main>;}`,{
    './Shell.tsx':`export function Shell({children}){return <section><h2>Before</h2>{children}<aside><i>Prefix</i><em>Second prefix</em>{children}</aside></section>;}`,
    './state.ts':`export let open=true;export let n=1;export let items=[{id:1,label:'one'},{id:2,label:'two'}];
      export function next(){n++;}export function flip(){open=!open;}export function reverse(){items=items.toReversed();}`,
    './Control.tsx':`import {next,flip,reverse} from './state';export function Control(){return <nav>
      <button class="next" onClick={next}>Next</button><button class="flip" onClick={flip}>Flip</button><button class="reverse" onClick={reverse}>Reverse</button></nav>;}`,
  });
  click('.next');
  if(kind==='conditional'){
    expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(['2','2']);
    click('.flip');expect(document.querySelectorAll('b')).toHaveLength(0);
    click('.flip');expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(['2','2']);
  }else{
    const rows=[...document.querySelectorAll('li')];
    expect(rows.map(node=>node.textContent)).toEqual(['one:2','two:2','one:2','two:2']);
    click('.reverse');expect([...document.querySelectorAll('li')]).toEqual([rows[1],rows[0],rows[3],rows[2]]);
  }
});

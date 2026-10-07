import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, registeredIds, unregisterSubtree, resetScheduler, setScheduler,
  type MountedApplication } from '@memoized-dom/runtime/testing';

const compileInitial: typeof compileModulesDetailed = (sources, options = {}) =>
  compileModulesDetailed(sources, { initialContent: true, ...options });

const directory=join(import.meta.dirname,'fixtures/out/initial-lists');
let app:MountedApplication|undefined;
afterEach(()=>{
  app?.unmount();app=undefined;
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();
});
function compile(source:string) {
  const runtimePath='@memoized-dom/runtime/testing';
  return compileInitial({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source},{runtimePath});
}
async function mount(name:string,source:string) {
  const result=compile(source);expect(result.initialRender.kind).toBe('bindings');
  const html=emitInitialHtml(result.initialRender);expect(html).not.toBeNull();
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,`${name}.ts`),result.output!['./App.tsx']!);
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

it('retains row ref ownership for bound and later-created rows',async()=>{
  const refs:Node[]=[],disposed:Node[]=[];vi.stubGlobal('__initialRowRefs',refs);vi.stubGlobal('__initialRowDisposed',disposed);
  await mount('row-refs',`export function App(){let items=['one'];return <main>
    <button onClick={()=>items=['two']}>Replace</button>{items.map(item=><li ref={node=>{
      globalThis.__initialRowRefs.push(node);return ()=>globalThis.__initialRowDisposed.push(node);
    }}>{item}</li>)}</main>;}`);
  await Promise.resolve();const first=rows()[0]!;expect(refs).toEqual([first]);
  click('button');await Promise.resolve();const second=rows()[0]!;
  expect(second).not.toBe(first);expect(refs).toEqual([first,second]);expect(disposed).toEqual([first]);
  app!.unmount();app=undefined;expect(disposed).toEqual([first,second]);
});

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
  expect(result.output!['./App.tsx']).not.toContain('Static outside list');
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

it.each(['key={item.id}','key={index}'])('binds an empty extent and creates its first %s row normally',async key=>{
  await mount(key.includes('item')?'empty-keyed':'empty-positional',`export function App(){let items=[];let n=0;return <main>
    <button class="append" onClick={()=>{items=[...items,{id:n++,label:'new'}];}}>Add</button>
    <button class="clear" onClick={()=>{items=[];}}>Clear</button><ul>
    {items.map((item,index)=><li ${key}>{index}:{item.label}</li>)}</ul><p>{n}</p></main>;}`);
  const main=document.querySelector('main'),ul=document.querySelector('ul');expect(rows()).toEqual([]);
  click('.append');expect(rows()[0]!.textContent).toBe('0:new');expect(document.querySelector('p')!.textContent).toBe('1');
  const retained=rows()[0];click('.append');expect(rows()[0]).toBe(retained);
  click('.clear');expect(rows()).toEqual([]);click('.append');expect(rows()[0]!.textContent).toBe('0:new');
  expect(document.querySelector('main')).toBe(main);expect(document.querySelector('ul')).toBe(ul);
});

it('uses ordinary future factories and lifecycle for an empty composed list',async()=>{
  const log:string[]=[];vi.stubGlobal('__initialListLog',log);
  await mount('empty-component',`
    function Row({label}){$effect(()=>{globalThis.__initialListLog.push('mount');return ()=>{globalThis.__initialListLog.push('dispose');};});return <li>{label}</li>;}
    export function App(){let items=[];return <main><button class="append" onClick={()=>{items=[{id:1,label:'created'}];}}>Add</button>
      <button class="clear" onClick={()=>{items=[];}}>Clear</button>{items.map(({id,label})=><Row key={id} label={label}/>)}</main>;}`);
  expect(log).toEqual([]);click('.append');expect(rows()[0]!.textContent).toBe('created');
  expect(log).toEqual(['mount']);click('.clear');expect(rows()).toEqual([]);expect(log).toEqual(['mount','dispose']);
  click('.append');app!.unmount();app=undefined;expect(log).toEqual(['mount','dispose','mount','dispose']);expect(registeredIds()).toEqual([]);
});

it.each([false,true].flatMap(owned=>[false,true].map(indexed=>({owned,indexed}))))('binds component rows with retained state and later creation (%j)',async({owned,indexed})=>{
  const log:string[]=[];vi.stubGlobal('__componentRows',log);
  await mount(`component-rows-${owned}-${indexed}`,`
    function Row({item,index}){${owned?"let n=0;$effect(()=>{globalThis.__componentRows.push('mount');return ()=>globalThis.__componentRows.push('dispose');});":""}
      return <li data-id={item.id}><span>{index}:{item.label}</span><button onClick={()=>${owned?'n++':'item.label+=\'!\''}}>${owned?'{n}':'{item.label}'}</button></li>;}
    export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];let next=3;return <main>
      <button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
      <button class="append" onClick={()=>items=[...items,{id:next++,label:'new'}]}>Append</button>
      <button class="remove" onClick={()=>items=items.slice(1)}>Remove</button>
      <ul>{items.map((${indexed?'item,index':'item'})=><Row key={item.id} item={item} index={${indexed?'index':'-1'}}/>)}</ul><footer>Kept</footer></main>;}`);
  const original=rows();click('li button');
  expect(original[0]!.querySelector('button')!.textContent).toBe(owned?'1':'one!');
  click('.reverse');expect(rows()).toEqual(original.toReversed());
  expect(rows().map(row=>row.querySelector('span')!.textContent)).toEqual([`${indexed?0:-1}:two`,`${indexed?1:-1}:${owned?'one':'one!'}`]);
  expect(original[0]!.querySelector('button')!.textContent).toBe(owned?'1':'one!');
  click('.remove');expect(original[1]!.isConnected).toBe(false);click('.append');
  expect(rows()[0]).toBe(original[0]);expect(rows()[1]!.querySelector('span')!.textContent).toBe(`${indexed?1:-1}:new`);
  rows()[1]!.querySelector<HTMLButtonElement>('button')!.click();
  expect(rows()[1]!.querySelector('button')!.textContent).toBe(owned?'1':'new!');
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
  if(owned)expect(log.filter(value=>value==='mount')).toHaveLength(3);
  if(owned)expect(log.filter(value=>value==='dispose')).toHaveLength(3);
});

it.each([
  `let items=getItems();`,
])('falls back for an unproved initial source: %s',setup=>{
  const result=compile(`function getItems(){return ['one'];}export function App(){${setup}return <main>
    <button onClick={()=>{items=['two'];}}>Replace</button>{items.map(item=><li>{item}</li>)}</main>;}`);
  expect(result.initialContent).toBe(false);
});

it.each([0,2])('binds forwarded component-row caller slots and creates later rows (%i)',async count=>{
  const log:string[]=[];vi.stubGlobal('__componentRows',log);
  const items=[{id:1,label:'one'},{id:2,label:'two'}].slice(0,count);
  await mount(`row-slots-${count}`,`function Frame({children}){return <aside><i>Prefix</i>{children}</aside>;}
    function Row({children}){let n=0;$effect(()=>{globalThis.__componentRows.push('mount');return ()=>globalThis.__componentRows.push('dispose');});
      return <li><button class="local" onClick={()=>n++}>{n}</button>{children}<Frame>{children}</Frame></li>;}
    export function App(){let items=${JSON.stringify(items)};let n=0;let next=3;return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
      <button class="rename" onClick={()=>items=items.map(item=>({...item,label:item.label+'!'}))}>Rename</button>
      <button class="append" onClick={()=>items=[...items,{id:next++,label:'new'}]}>Append</button><button class="clear" onClick={()=>items=[]}>Clear</button>
      <ul>{items.map((item,index)=><Row key={item.id}><b>{index}:{item.label}:{n}</b></Row>)}</ul></main>;}`);
  if(!count)click('.append');const original=rows();click('.local');click('.next');click('.rename');click('.reverse');
  expect(rows()).toEqual(original.toReversed());expect(original[0]!.querySelector('.local')!.textContent).toBe('1');
  expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(count?['0:two!:1','0:two!:1','1:one!:1','1:one!:1']:['0:new!:1','0:new!:1']);
  click('.append');expect(rows().at(-1)!.querySelector('b')!.textContent).toBe(`${original.length}:new:1`);
  click('.clear');expect(original.every(node=>!node.isConnected)).toBe(true);click('.append');click('.next');
  expect([...document.querySelectorAll('b')].map(node=>node.textContent)).toEqual(['0:new:2','0:new:2']);
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
  expect(log.filter(value=>value==='mount').length).toBe(log.filter(value=>value==='dispose').length);
});

it.each([
  `<li>{show?<b>{item}</b>:null}</li>`,
  `<li>{Date.now()}</li>`, `<li {...{title:item}}>{item}</li>`,
])('falls back for unproved row semantics: %s',row=>{
  const result=compile(`export function App(){let items=['one'];let show=true;return <main>
    <button onClick={()=>{items=['two'];}}>Replace</button>{items.map(item=>${row})}</main>;}`);
  expect(result.initialContent).toBe(false);
});

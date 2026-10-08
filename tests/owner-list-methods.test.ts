import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, createListRegion, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory=join(import.meta.dirname,'fixtures/out/owner-list-methods');
const records="[{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}]";
const probe=`import * as runtime from '@memoized-dom/runtime/testing';export * from '@memoized-dom/runtime/testing';
  export function createListRegion(...args){const create=args[2];args[2]=(...values)=>{
    const entry=create(...values),update=entry.update;
    if(update)entry.update=(...values)=>{globalThis.__methodReplays++;return update(...values);};return entry;
  };return runtime.createListRegion(...args);}`;
async function load(body:string,name:string){
  const output=compileModules({'./App.tsx':`export function App(){${body}}`},{runtimePath:'./probe'})['./App.tsx']!;
  const target=join(directory,name);mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'App.ts'),output);writeFileSync(join(target,'probe.ts'),probe);
  const specifier=`./fixtures/out/owner-list-methods/${name}/App.ts`;
  return {output,App:(await import(specifier)).App};
}
const reads=()=>(globalThis as unknown as {__methodReplays:number}).__methodReplays;
const reset=()=>{(globalThis as unknown as {__methodReplays:number}).__methodReplays=0;};
beforeEach(()=>{document.body.replaceChildren();resetAccessTable();stubGlobal('__methodReplays',0);});
afterEach(()=>{_internals().registry.forEach((_,id)=>unregister(id));resetAccessTable();resetScheduler();unstubAllGlobals();});

it.each([false,true])('preserves identity and selection across guarded native transformations (deferred=%s)',async deferred=>{
  const {App,output}=await load(`let items=${records};let selected=0;const select=id=>{selected=id;};
    const reverse=()=>{items=items.toReversed();};
    return <main><button id="reverse" onClick={reverse}>reverse</button>
      <button id="slice" onClick={()=>{const end=items.length-1;items=items.slice(0,end);}}>slice</button>
      <button id="filter" onClick={()=>{items=items.filter((row,index)=>index%2===0 && row.id>0);}}>filter</button>
      <button id="append" onClick={()=>{items=items.concat([{id:4,label:'four'}]);}}>append</button>
      <button id="prepend" onClick={()=>{items=[{id:5,label:'five'}].concat(items);}}>prepend</button>
      <button id="spread" onClick={()=>{items=[...items];}}>spread</button>
      <button id="change" onClick={()=>{items=items.map((row,index)=>index===0?{id:row.id,label:row.label+'!'}:row);}}>change</button>
      <button id="mixed" onClick={()=>{items=items.toReversed();selected=4;}}>mixed</button>
      <ul>{items.map(row=><li key={row.id} class={selected===row.id?'danger':''}>
        <a onClick={()=>select(row.id)}>{row.label}</a></li>)}</ul></main>;`, `native-${deferred}`);
  expect(output).toContain('evaluateListOperation');
  const pending:Array<()=>void>=[];setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{for(let turns=0;pending.length;turns++){
    if(turns>=50)throw new Error('Owner refresh failed to settle');pending.shift()!();
  }};
  document.body.append(App('Native',null));flush();
  const rows=()=>[...document.querySelectorAll('li')];const original=rows();
  const click=(id:string)=>{reset();document.getElementById(id)!.click();flush();};
  original[2]!.querySelector('a')!.click();flush();expect(original[2]!.className).toBe('danger');
  click('reverse');expect(reads()).toBe(0);expect(rows()).toEqual(original.toReversed());
  click('slice');expect(reads()).toBe(0);expect(rows()).toEqual([original[2],original[1]]);
  click('filter');expect(reads()).toBe(0);expect(rows()).toEqual([original[2]]);
  click('append');expect(reads()).toBe(0);expect(rows()[0]).toBe(original[2]);
  const fourth=rows()[1]!;
  click('prepend');expect(reads()).toBe(0);expect(rows().slice(1)).toEqual([original[2],fourth]);
  const fifth=rows()[0]!;
  click('spread');expect(reads()).toBe(0);expect(rows()).toEqual([fifth,original[2],fourth]);
  click('change');expect(reads()).toBe(1);expect(rows()).toEqual([fifth,original[2],fourth]);
  expect(fifth.textContent).toBe('five!');expect(original[2]!.className).toBe('danger');
  click('mixed');expect(reads()).toBe(3);expect(rows()).toEqual([fourth,original[2],fifth]);
  expect(rows().map(row=>row.className)).toEqual(['danger','','']);
});

it('skips a full retained set while updating only replaced records in a large collection',async()=>{
  const count=1000;
  const values=Array.from({length:count},(_,id)=>`{id:${id},label:'row ${id}'}`).join(',');
  const {App,output}=await load(`let items=[${values}];return <main>
    <button id="rotate" onClick={()=>{items=items.slice(-1).concat(items.slice(0,-1));}}>rotate</button>
    <button id="update" onClick={()=>{items=items.map((row,index)=>index%10===0?{id:row.id,label:row.label+'!'}:row);}}>update</button>
    <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;`,'large');
  expect(output).toContain('evaluateListOperation');
  setScheduler(run=>run());document.body.append(App('Large',null));
  const original=[...document.querySelectorAll('li')];
  document.getElementById('rotate')!.click();expect(reads()).toBe(0);
  const rotated=[...document.querySelectorAll('li')];
  expect(rotated).toEqual([original[count-1],...original.slice(0,-1)]);
  reset();document.getElementById('update')!.click();expect(reads()).toBe(count/10);
  expect([...document.querySelectorAll('li')]).toEqual(rotated);
  rotated.forEach((row,index)=>expect(row.textContent).toBe(`row ${(index+count-1)%count}${index%10===0?'!':''}`));
});

it('keeps escaped rows untrusted after an overridden method is restored, and recovers on fresh records',async()=>{
  const {App}=await load(`let items=${records};return <main>
    <button id="copy" onClick={()=>{items=items.slice();}}>copy</button>
    <button id="fresh" onClick={()=>{items=${records};}}>fresh</button>
    <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;`,'sticky-method');
  setScheduler(run=>run());document.body.append(App('StickyMethod',null));
  const original=[...document.querySelectorAll('li')];let saved:Array<{label:string}>|undefined;
  const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'slice')!;
  Object.defineProperty(Array.prototype,'slice',{...descriptor,value:function(...args:unknown[]){
    if(this[0]?.label==='one'){saved=[this[0],this[1],this[2]];this[0].label='changed';}
    return Reflect.apply(descriptor.value,this,args);
  }});
  try {document.getElementById('copy')!.click();}
  finally {Object.defineProperty(Array.prototype,'slice',descriptor);}
  expect(reads()).toBe(3);expect(original[0]!.textContent).toBe('changed');
  expect(saved).toBeDefined();saved![1]!.label='later';
  reset();document.getElementById('copy')!.click();expect(reads()).toBe(3);
  expect(original[1]!.textContent).toBe('later');
  reset();document.getElementById('fresh')!.click();expect(reads()).toBe(3);
  expect([...document.querySelectorAll('li')]).toEqual(original);
  expect(original.map(row=>row.textContent)).toEqual(['one','two','three']);
  saved![0]!.label='old escaped row';reset();document.getElementById('copy')!.click();
  expect(reads()).toBe(0);expect(original[0]!.textContent).toBe('one');
});

it('does not trust a species constructor that captures rows before methods are restored',async()=>{
  const {App}=await load(`let items=${records};return <main>
    <button onClick={()=>{items=items.slice();}}>copy</button>
    <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;`,'species');
  setScheduler(run=>run());document.body.append(App('Species',null));
  const descriptor=Object.getOwnPropertyDescriptor(Array,Symbol.species)!;
  const allocations:unknown[][]=[];
  Object.defineProperty(Array,Symbol.species,{configurable:true,value:function(){const value:unknown[]=[];allocations.push(value);return value;}});
  try {document.querySelector('button')!.click();}
  finally {Object.defineProperty(Array,Symbol.species,descriptor);}
  const saved=allocations.find(value=>(value[0] as {label?:string}|undefined)?.label==='one') as Array<{label:string}>;
  expect(reads()).toBe(3);expect(saved).toBeDefined();
  saved[0]!.label='escaped';reset();document.querySelector('button')!.click();
  expect(reads()).toBe(3);expect(document.querySelector('li')!.textContent).toBe('escaped');
});

it('keeps iterator escapes untrusted after the iterator is restored',async()=>{
  const {App}=await load(`let items=${records};return <main>
    <button onClick={()=>{items=[...items];}}>copy</button>
    <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;`,'iterator');
  setScheduler(run=>run());document.body.append(App('Iterator',null));
  const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator)!;
  let saved:Array<{label:string}>|undefined;
  Object.defineProperty(Array.prototype,Symbol.iterator,{...descriptor,value:function*(){
    if(this[0]?.label==='one'){saved=[this[0],this[1],this[2]];this[0].label='changed';}
    yield* Reflect.apply(descriptor.value,this,[]);
  }});
  try {document.querySelector('button')!.click();}
  finally {Object.defineProperty(Array.prototype,Symbol.iterator,descriptor);}
  expect(reads()).toBe(3);expect(document.querySelector('li')!.textContent).toBe('changed');
  saved![0]!.label='later';reset();document.querySelector('button')!.click();
  expect(reads()).toBe(3);expect(document.querySelector('li')!.textContent).toBe('later');
});

it('does not expose source records through internal snapshot species hooks',()=>{
  const parent=document.createElement('ul');document.body.append(parent);
  const items=[{id:1,label:'one'},{id:2,label:'two'}];
  const allocations:unknown[][]=[];
  const descriptor=Object.getOwnPropertyDescriptor(Array,Symbol.species)!;
  const region=createListRegion(parent,'Snapshot',(item)=>({nodes:document.createTextNode(item.label),entities:[]}),item=>item.id);
  Object.defineProperty(Array,Symbol.species,{configurable:true,value:function(){const value:unknown[]=[];allocations.push(value);return value;}});
  try {region.reconcile(items);region.reconcile(items.toReversed(),true);}
  finally {Object.defineProperty(Array,Symbol.species,descriptor);}
  expect(parent.textContent).toBe('twoone');
  expect(allocations.some(values=>values.some(value=>items.includes(value as typeof items[number])))).toBe(false);
  region.dispose();
});

it('updates rendered indices during a proven native reorder',async()=>{
  const {App,output}=await load(`let items=${records};return <main>
    <button onClick={()=>{items=items.toReversed();}}>reverse</button>
    <ul>{items.map((row,index)=><li key={row.id}>{row.label}:{index}</li>)}</ul></main>;`,'indices');
  expect(output).toContain('evaluateListOperation');
  setScheduler(run=>run());document.body.append(App('Indices',null));
  const original=[...document.querySelectorAll('li')];document.querySelector('button')!.click();
  expect(reads()).toBe(2);expect([...document.querySelectorAll('li')]).toEqual(original.toReversed());
  expect(original.map(row=>row.textContent)).toEqual(['one:2','two:1','three:0']);
});

it('keeps failed operations untrusted even when they restore themselves before throwing',async()=>{
  const {App}=await load(`let items=${records};return <main>
    <button onClick={()=>{try{items=items.slice();}catch{items=items.toReversed();}}}>copy</button>
    <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;`,'throw');
  setScheduler(run=>run());document.body.append(App('Throw',null));
  const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'slice')!;
  let saved:{label:string}|undefined;
  Object.defineProperty(Array.prototype,'slice',{...descriptor,value:function(...args:unknown[]){
    if(this[0]?.label==='one'){
      saved=this[0];saved!.label='changed';Object.defineProperty(Array.prototype,'slice',descriptor);
      throw new Error('failed copy');
    }
    return Reflect.apply(descriptor.value,this,args);
  }});
  try {document.querySelector('button')!.click();}
  finally {Object.defineProperty(Array.prototype,'slice',descriptor);}
  expect(reads()).toBe(3);expect(document.body.textContent).toContain('changed');
  saved!.label='later';reset();document.querySelector('button')!.click();
  expect(reads()).toBe(3);expect(document.body.textContent).toContain('later');
});

it.each([
  'items.filter(row=>{row.label="changed";return true;})',
  'items.filter(row=>opaque(row))',
  'items.map(row=>{globalThis.saved=row;return row;})',
  'items.map(row=>({id:row.id,label:opaque(row.label)}))',
  'items.map(row=>({...row}))',
  'items.map(row=>({id:row.id,get label(){return row.label}}))',
  'items.map(row=>({id:row.id,label:row.missing}))',
  'items.inspect()',
])('retains ordinary replay for an unproven transformation: %s',expression=>{
  const output=compileModules({'./App.tsx':`export function App(){let items=${records};
    return <main><button onClick={()=>{items=${expression};}}>change</button>
      <ul>{items.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}`})['./App.tsx']!;
  expect(output).not.toContain('evaluateListOperation');
});

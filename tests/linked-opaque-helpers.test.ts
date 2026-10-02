import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory=join(import.meta.dirname,'fixtures/out/linked-opaque-helpers');
const clock={value:0};
const frames:FrameRequestCallback[]=[];
const helper=`import {clock} from './external';
  const alias=clock;
  export function readValue(){return alias.value;}
  export function isActive(){return readValue()>0;}
  export function pure(value){return value+1;}`;
function modules(reexport:boolean,rows=false){
  return {'./helper.ts':helper,
    './bridge.ts':`import {isActive,readValue} from './helper';
      export function enabled(){return isActive();} export {readValue as value};`,
    './barrel.ts':`import {enabled,value} from './bridge'; export {enabled,value};`,
    './app.tsx':rows ? `import {value} from './barrel';const items=[{id:1},{id:2}];
      function Row({item}){return <li>{item.id}:{value()}</li>;}
      export function App(){return <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul>;}`
      : `import {${reexport?'enabled as active,value':'isActive as active,readValue as value'}} from './${reexport?'barrel':'helper'}';
      export function App(){let b=0;let chosen='idle';if(active())chosen='active';const label=chosen+'!';
        return <main><p class="chosen">{label}</p><p class="value">{value()}</p>
          <button onClick={()=>{b++;}}>{b}</button></main>;}`};
}
function write(name:string,output:Record<string,string>){
  const target=join(directory,name);mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'external.ts'),'export const clock=globalThis.__linkedHelperClock;');
  for(const [file,code] of Object.entries(output))writeFileSync(join(target,file.slice(2).replace(/\.tsx$/,'.ts')),code);
}
beforeEach(()=>{
  document.body.replaceChildren();resetAccessTable();clock.value=0;frames.length=0;
  vi.stubGlobal('__linkedHelperClock',clock);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
});
afterEach(()=>{
  _internals().registry.forEach((_,id)=>unregister(id));
  while(frames.length)frames.shift()!(performance.now());
  resetAccessTable();resetScheduler();vi.unstubAllGlobals();
});

it('carries captured opaque reads through nested calls, aliases and re-exports without write effects',()=>{
  const {metadata,output}=compileModulesDetailed(modules(true));
  for(const [file,names] of [['./helper.ts',['readValue','isActive']],['./bridge.ts',['enabled','value']],['./barrel.ts',['enabled','value']]] as const){
    for(const name of names)expect(metadata[file]!.functionExports.find(entry=>entry.exported===name))
      .toMatchObject({opaqueReads:true,reads:[],writes:[],boundedWrites:[],parameterWrites:[],unbounded:false});
  }
  expect(metadata['./helper.ts']!.functionExports.find(entry=>entry.exported==='pure')).not.toHaveProperty('opaqueReads',true);
  expect(output['./app.tsx']).toContain('volatile: true');
  expect(output['./app.tsx']).not.toContain('markDirtySubtree');
});

it.each([false,true].flatMap(reexport=>[false,true].map(deferred=>({reexport,deferred}))))(
  'refreshes hidden linked reads (reexport=$reexport, deferred=$deferred)',async({reexport,deferred})=>{
  const name=`app-${reexport}-${deferred}`;write(name,compileModulesDetailed(modules(reexport)).output);
  const pending:Array<()=>void>=[];setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/linked-opaque-helpers/${name}/app.ts`;
  const {App}=await import(specifier);
  document.body.append(App('First',null),App('Second',null));
  const roots=[...document.querySelectorAll('main')], nodes=roots.map(root=>root.querySelector('.chosen')!.firstChild);
  const check=(active:boolean,value:number)=>roots.forEach((root,index)=>{
    expect(root.querySelector('.chosen')!.textContent).toBe(active?'active!':'idle!');
    expect(root.querySelector('.value')!.textContent).toBe(String(value));
    expect(root.querySelector('.chosen')!.firstChild).toBe(nodes[index]);
  });
  const pull=()=>{const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());};
  check(false,0);clock.value=2;pull();roots[0]!.querySelector<HTMLButtonElement>('button')!.click();flush();check(true,2);
  expect(roots[0]!.querySelector('button')!.textContent).toBe('1');expect(roots[1]!.querySelector('button')!.textContent).toBe('0');
  clock.value=0;pull();flush();check(false,0);
});

it.each([false,true])('keeps rows with hidden imported reads registered (deferred=%s)',async deferred=>{
  const name=`rows-${deferred}`;write(name,compileModulesDetailed(modules(true,true)).output);
  const pending:Array<()=>void>=[];setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const specifier=`./fixtures/out/linked-opaque-helpers/${name}/app.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Rows',null));const nodes=[...document.querySelectorAll('li')];
  clock.value=3;const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());
  while(pending.length)pending.shift()!();
  [...document.querySelectorAll('li')].forEach((node,index)=>{expect(node).toBe(nodes[index]);expect(node.textContent).toBe(`${index+1}:3`);});
});

it('does not confuse property names or shadowed captures with opaque reads',()=>{
  const {metadata,output}=compileModulesDetailed({'./helper.ts':`${helper}
    export function shadow(clock){return clock.value;}
    export function shadowCall(readValue){return readValue();}
    export function property(){const object={clock:1};return object.clock;}`,
    './app.tsx':`import {pure,property} from './helper'; export function App(){let a=0,b=0;
      return <button onClick={()=>{a++;}}>{pure(a)}:{property()}:{b}</button>;}`});
  for(const name of ['shadow','shadowCall','property','pure'])expect(metadata['./helper.ts']!.functionExports.find(entry=>entry.exported===name)).not.toHaveProperty('opaqueReads',true);
  expect(output['./app.tsx']).not.toContain('volatile: true');
});

it('preserves routed read keys alongside the separate opaque read flag',()=>{
  const {metadata}=compileModulesDetailed({'./helper.ts':`import {clock} from './external';
    export const state={value:0};export function mixed(){return state.value+clock.value;}`,
    './app.tsx':`import {mixed} from './helper';export function App(){return <p>{mixed()}</p>;}`});
  const summary=metadata['./helper.ts']!.functionExports.find(entry=>entry.exported==='mixed');
  expect(summary).toMatchObject({opaqueReads:true,writes:[],boundedWrites:[],parameterWrites:[],unbounded:false});
  expect(summary!.reads).toContain('./helper.ts#state.value');
});

it('retains conservative effects for a helper writing a captured opaque input',()=>{
  expect(()=>compileModulesDetailed({'./helper.ts':`import {clock} from './external';export function change(){clock.value++;return clock.value>0;}`,
    './app.tsx':`import {change} from './helper';export function App(){let chosen='idle';if(change())chosen='active';return <p>{chosen}</p>;}`}))
    .toThrow(/replays a call that writes state/);
});

it.each([
  'clock.tick?.()',
  'clock?.tick()',
  'const local=clock;local.tick()',
  'let local={};local=clock;local.tick()',
  'Object.assign(clock,{value:1})',
  'delete clock.value',
  'const tick=clock.tick;tick()',
  'function write(target){target.value++;}write(clock)',
])('does not replay captured opaque effects: %s', effect=>{
  expect(()=>compileModulesDetailed({'./helper.ts':`import {clock} from './external';export function change(){${effect};return clock.value>0;}`,
    './app.tsx':`import {change} from './helper';export function App(){let chosen='idle';if(change())chosen='active';return <p>{chosen}</p>;}`}))
    .toThrow(/replays a call that writes state/);
});

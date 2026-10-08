import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory=join(import.meta.dirname,'fixtures/out/opaque-control-flow');
const clock={value:0, fallback:'fallback', fail:false, reads:0,
  get current(){this.reads++;if(this.fail)throw new Error('opaque getter');return this.value;}};
const frames:FrameRequestCallback[]=[];
const patterns={
  partial: 'if(resource.current>0)chosen="active";',
  switch: 'switch(resource.current){case 1:chosen="active";break;case 2:chosen="second";break;}',
  helper: 'function enabled(){return resource.current>0;} if(enabled())chosen="active";',
  module: 'if(moduleEnabled())chosen="active";',
  rhs: 'if(true)chosen=resource.current>0 ? "active" : "idle";',
  imported: 'if(clock.current>0)chosen="active";',
  nested: 'if(resource.current>0){if(resource.current===2)chosen="second";else chosen="active";}',
};
function source(pattern:string,unrelated:boolean){
  return `import {clock} from './external';
    ${pattern===patterns.module?'function moduleEnabled(){return clock.current>0;}':''}
    export function App(){
    const resource=clock;let chosen="idle";${unrelated?'let b=0;':''}
    ${pattern}const label=chosen+"!";
    return <main><p class="value">{chosen}</p><p class="derived">{label}</p>
      ${unrelated?'<button onClick={()=>{b++;}}>{b}</button>':''}</main>;}`;
}
function compile(text:string){return compileModules({'./app.tsx':text})['./app.tsx']!;}
beforeEach(()=>{
  document.body.replaceChildren();resetAccessTable();frames.length=0;
  clock.value=0;clock.fail=false;clock.reads=0;
  stubGlobal('__controlClock',clock);
  stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
});
afterEach(()=>{
  clock.fail=false;
  _internals().registry.forEach((_,id)=>unregister(id));
  while(frames.length)frames.shift()!(performance.now());
  resetAccessTable();resetScheduler();unstubAllGlobals();
});

it.each([false,true].flatMap(deferred=>[false,true].map(linked=>({deferred,linked}))))(
  'keeps opaque calculations live inside component rows (deferred=$deferred, linked=$linked)',async({deferred,linked})=>{
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'external.ts'),'export const clock=globalThis.__controlClock;');
  const row=`import {clock} from './external';
    export function Row({item}){const resource=clock;let chosen="idle";
      if(resource.current>=item.id)chosen="active";const label=chosen+"!";
      return <li class={chosen}>{item.id}:{label}</li>;}`;
  const app='const items=[{id:1},{id:2}]; export function App(){return <ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul>;}';
  let code:string;
  if(linked){
    const rowKey=`./row-${deferred}.tsx`;
    const modules=compileModules({[rowKey]:row,'./app.tsx':`import {Row} from './row-${deferred}';${app}`});
    writeFileSync(join(directory,`row-${deferred}.ts`),modules[rowKey]!);code=modules['./app.tsx']!;
  }else code=compile(row+app);
  writeFileSync(join(directory,`rows-${deferred}-${linked}.ts`),code);
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-control-flow/rows-${deferred}-${linked}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Rows',null));
  const retained=[...document.querySelectorAll('li')];
  const check=(active:number)=>[...document.querySelectorAll('li')].forEach((node,index)=>{
    expect(node).toBe(retained[index]);
    expect(node.className).toBe(index<active?'active':'idle');
    expect(node.textContent).toBe(`${index+1}:${index<active?'active':'idle'}!`);
  });
  check(0);
  for(const active of [1,2,0]){clock.value=active;frames.shift()!(performance.now());flush();check(active);}
});

it.each([false,true])('recovers a getter failure without stopping future pulls (deferred=%s)',async deferred=>{
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'external.ts'),'export const clock=globalThis.__controlClock;');
  writeFileSync(join(directory,`failure-${deferred}.ts`),compile(source(patterns.partial,true)));
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-control-flow/failure-${deferred}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('Failure',null));
  const retained=document.querySelector('.derived')!.firstChild;
  const pull=()=>{const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());};
  clock.fail=true;
  if(deferred){pull();expect(flush).toThrow('opaque getter');}
  else expect(pull).toThrow('opaque getter');
  expect(document.querySelector('.derived')!.textContent).toBe('idle!');
  clock.fail=false;clock.value=1;pull();flush();
  expect(document.querySelector('.derived')!.textContent).toBe('active!');
  expect(document.querySelector('.derived')!.firstChild).toBe(retained);
  clock.value=0;pull();flush();expect(document.querySelector('.derived')!.textContent).toBe('idle!');
});

const cases=Object.entries(patterns).flatMap(([name,pattern])=>[false,true].flatMap(unrelated=>
  [false,true].map(deferred=>({name,pattern,unrelated,deferred}))));
it.each(cases)('replays opaque-only $name (unrelated=$unrelated, deferred=$deferred)',async({name,pattern,unrelated,deferred})=>{
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'external.ts'),'export const clock=globalThis.__controlClock;');
  const file=`${name}-${unrelated}-${deferred}`;
  const code=compile(source(pattern,unrelated));
  expect(code).toContain('volatile: true');
  writeFileSync(join(directory,`${file}.ts`),code);
  const pending:Array<()=>void>=[];
  setScheduler(run=>{if(deferred)pending.push(run);else run();});
  const flush=()=>{while(pending.length)pending.shift()!();};
  const specifier=`./fixtures/out/opaque-control-flow/${file}.ts`;
  const {App}=await import(specifier);
  document.body.append(App('First',null),App('Second',null));
  const roots=[...document.querySelectorAll('main')];
  const nodes=roots.map(root=>[root.querySelector('.value')!.firstChild,root.querySelector('.derived')!.firstChild]);
  const check=(expected:string)=>roots.forEach((root,index)=>{
    expect(root.querySelector('.value')!.textContent).toBe(expected);
    expect(root.querySelector('.derived')!.textContent).toBe(expected+'!');
    expect(root.querySelector('.value')!.firstChild).toBe(nodes[index]![0]);
    expect(root.querySelector('.derived')!.firstChild).toBe(nodes[index]![1]);
  });
  const pull=()=>{const frame=frames.shift();expect(frame).toBeTypeOf('function');frame!(performance.now());};
  check('idle');clock.value=1;pull();
  if(unrelated)roots[0]!.querySelector<HTMLButtonElement>('button')!.click();
  flush();check('active');
  if(unrelated){expect(roots[0]!.querySelector('button')!.textContent).toBe('1');expect(roots[1]!.querySelector('button')!.textContent).toBe('0');}
  clock.value=2;pull();flush();check(name==='switch'||name==='nested'?'second':'active');
  clock.value=0;pull();flush();check('idle');
});

it('keeps side-effectful control flow as one-time setup',()=>{
  const code=compile(source('if(resource.current>0){clock.connect();chosen="active";}',false));
  expect(code.slice(code.indexOf('const _update'))).not.toContain('clock.connect()');
});

it('does not attribute property names or shadowed helper parameters to opaque imports',()=>{
  for(const pattern of [
    'const object={clock:true}; if(object.clock)chosen="active";',
    'function enabled(clock){return clock;} if(enabled(true))chosen="active";',
  ])expect(compile(source(pattern,false))).not.toContain('volatile: true');
});

it('diagnoses writes in opaque-only control helpers',()=>{
  expect(()=>compile(source('function enabled(){resource.value++;return resource.current>0;} if(enabled())chosen="active";',false)))
    .toThrow(/replays a call that writes state/);
});

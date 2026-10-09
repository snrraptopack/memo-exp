import { expect, it } from 'bun:test';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDesktopApplication, defineSceneComponent, mountScene, sceneEvent, type SceneInstance, type SceneTransaction, type SceneTemplate } from '../src';

const runtimePath=pathToFileURL(resolve(import.meta.dirname,'../src/index.ts')).href;
const rejection=(promise:Promise<unknown>)=>promise.then(()=>{throw new Error('Expected rejection');},error=>error as Error);
async function load(source:string) {
  const {code}=compileDesktop(source,{moduleId:'regions.tsx',runtimePath});
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as Promise<{App():SceneInstance}>;
}
function recording() {
  const templates:SceneTemplate[]=[]; const transactions:SceneTransaction[]=[]; let reject=false;
  const app=createDesktopApplication({async install(template){templates.push(template);},async commit(transaction){
    transactions.push(transaction); if(reject){reject=false;throw new Error('region rejected');} return {sequence:transaction.sequence};
  }});
  return {app,templates,transactions,reject(){reject=true;}};
}
const source=`
  function A({value}){let clicks=0;return <section><p>A: {value}</p><button onClick={()=>clicks++}>Clicks: {clicks}</button></section>;}
  function B({value}){return <section><p>B: {value}</p></section>;}
  export function App(){let shown=true;let value=0;return <main><button onClick={()=>shown=!shown}>Toggle</button><button onClick={()=>value++}>Count</button>{shown?<A value={value}/>:<B value={value}/>}</main>;}
`;

it('retains an unchanged branch, atomically replaces it, and recreates retired local state',async()=>{
  const {App}=await load(source);const f=recording();const root=f.app.mount(App);await root.ready;
  expect(f.templates).toHaveLength(3);expect(f.transactions[0]!.operations).toHaveLength(2);
  const first=f.transactions[0]!.operations[1]!.handle;
  await f.app.dispatch(first,0);await root.dispatch(1);
  expect(f.transactions.at(-1)!.operations).toEqual([{kind:'update',handle:first,values:[{slot:0,value:'1'}]}]);
  await root.dispatch(0);const replaced=f.transactions.at(-1)!;
  expect(replaced.operations.map(operation=>operation.kind)).toEqual(['dispose','mount']);
  expect(replaced.operations[0]!.handle).toEqual(first);
  expect(replaced.operations[1]).toMatchObject({template:'regions.tsx#B',values:[{slot:0,value:'1'}],attach_to:{handle:root.handle}});
  expect((await rejection(f.app.dispatch(first,0))).message).toContain('retired owner');
  await root.dispatch(0);
  const fresh=f.transactions.at(-1)!.operations[1]!;
  expect(fresh.handle).not.toEqual(first);
  expect(fresh).toMatchObject({template:'regions.tsx#A',values:[{slot:0,value:'1'},{slot:1,value:'0'}]});
  await f.app.dispose();
});

it('keeps rejected replacement pending at the same sequence and owner identity',async()=>{
  const {App}=await load(source);const f=recording();const root=f.app.mount(App);await root.ready;
  f.reject();expect((await rejection(root.dispatch(0))).message).toBe('region rejected');
  const failed=f.transactions[1]!;await root.flush();
  expect(f.transactions[2]).toEqual(failed);
  await f.app.dispose();
});

it('cancels a rejected candidate when the condition returns to its accepted branch',async()=>{
  const {App}=await load(source);const f=recording();const root=f.app.mount(App);await root.ready;
  const first=f.transactions[0]!.operations[1]!.handle;
  await f.app.dispatch(first,0);
  f.reject();await rejection(root.dispatch(0));const candidate=f.transactions.at(-1)!.operations[1]!.handle;
  await root.dispatch(0);expect(f.transactions).toHaveLength(3);
  await f.app.dispatch(first,0);
  expect(f.transactions.at(-1)!.operations).toEqual([{kind:'update',handle:first,values:[{slot:1,value:'2'}]}]);
  expect((await rejection(f.app.dispatch(candidate,0))).message).toContain('retired owner');
  await f.app.dispose();
});

it('does not execute inactive setup or props and supports an empty logical branch',async()=>{
  const {App}=await load(`function Child({value}){return <p>{value}</p>;}export function App(){let shown=false;function checked(){if(!shown)throw new Error('inactive props');return 9;}return <main><button onClick={()=>shown=!shown}>Toggle</button>{shown&&<Child value={checked()}/>}</main>;}`);
  const f=recording();const root=f.app.mount(App);await root.ready;
  expect(f.transactions[0]!.operations).toHaveLength(1);expect(f.templates).toHaveLength(2);
  await root.dispatch(0);expect(f.transactions[1]!.operations).toHaveLength(1);
  expect(f.transactions[1]!.operations[0]).toMatchObject({kind:'mount',values:[{slot:0,value:'9'}]});
  await root.dispatch(0);expect(f.transactions[2]!.operations[0]!.kind).toBe('dispose');
  await f.app.dispose();
});

it('keeps the accepted tree live when replacement setup throws and permits later recovery',async()=>{
  const {App}=await load(`function A(){let clicks=0;return <button onClick={()=>clicks++}>{clicks}</button>;}function B({value}){if(value===0)throw new Error('setup failed');return <p>{value}</p>;}export function App(){let shown=true;let value=0;return <main><button onClick={()=>shown=!shown}>Toggle</button><button onClick={()=>value++}>Count</button>{shown?<A/>:<B value={value}/>}</main>;}`);
  const f=recording();const root=f.app.mount(App);await root.ready;const first=f.transactions[0]!.operations[1]!.handle;
  expect((await rejection(root.dispatch(0))).message).toBe('setup failed');expect(f.transactions).toHaveLength(1);
  await root.dispatch(0);await f.app.dispatch(first,0);
  expect(f.transactions.at(-1)!.operations[0]).toMatchObject({kind:'update',handle:first,values:[{slot:0,value:'1'}]});
  await root.dispatch(1);await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations[1]).toMatchObject({kind:'mount',template:'regions.tsx#B',values:[{slot:0,value:'1'}]});
  await f.app.dispose();
});

it('rejects unsupported inline conditional subtrees explicitly',()=>{
  expect(()=>compileDesktop(`export function App(){let shown=true;return <main>{shown?<div>inline</div>:null}</main>;}`)).toThrow('inline subtrees');
});

it('rejects nullish component choices rather than interpreting them as truthy fallbacks',()=>{
  expect(()=>compileDesktop(`function Child(){return <p>child</p>;}export function App(){let value=0;return <main>{value??<Child/>}</main>;}`)).toThrow('nullish desktop component choices');
});

it('uses the shared truthiness contract for a logical fallback component',async()=>{
  const {App}=await load(`function Child(){return <p>fallback</p>;}export function App(){let hidden=true;return <main><button onClick={()=>hidden=!hidden}>Toggle</button>{hidden||<Child/>}</main>;}`);
  const f=recording();const root=f.app.mount(App);await root.ready;
  expect(f.transactions[0]!.operations).toHaveLength(1);
  await root.dispatch(0);expect(f.transactions[1]!.operations[0]).toMatchObject({kind:'mount',template:'regions.tsx#Child'});
  await root.dispatch(0);expect(f.transactions[2]!.operations[0]!.kind).toBe('dispose');
  await f.app.dispose();
});

it('normalizes else-if chains and treats distinct sites using the same component as distinct branches',async()=>{
  const {App}=await load(`function Child({label}){let clicks=0;return <button onClick={()=>clicks++}>{label}: {clicks}</button>;}export function App(){let mode=0;return <main><button onClick={()=>mode=(mode+1)%3}>Next</button>{mode===0?<Child label="A"/>:mode===1?<Child label="B"/>:null}</main>;}`);
  const f=recording();const root=f.app.mount(App);await root.ready;const first=f.transactions[0]!.operations[1]!.handle;
  await f.app.dispatch(first,0);await root.dispatch(0);
  expect(f.transactions.at(-1)!.operations[1]).toMatchObject({kind:'mount',values:[{slot:0,value:'B'},{slot:1,value:'0'}]});
  expect(f.transactions.at(-1)!.operations[1]!.handle).not.toEqual(first);
  await root.dispatch(0);expect(f.transactions.at(-1)!.operations.map(operation=>operation.kind)).toEqual(['dispose']);
  await f.app.dispose();
});

it('attaches a conditional root without adding an authored layout wrapper',async()=>{
  const {App}=await load(`function Child(){return <p>child</p>;}export function App(){let shown=true;return shown?<Child/>:null;}`);
  const f=recording();const root=f.app.mount(App);await root.ready;
  expect(f.templates[0]!.nodes).toEqual([{kind:'region',parent:null}]);
  expect(f.transactions[0]!.operations[1]).toMatchObject({attach_to:{handle:root.handle,node:0}});
  await f.app.dispose();
});

it('runs candidate setup once across rejection and settles its readiness only on acceptance',async()=>{
  const f=recording();let shown=false;let setups=0;let candidate:SceneInstance|undefined;
  const template:SceneTemplate={id:'ready-child',nodes:[{kind:'text',parent:null,text:'child'}],slots:[],events:[]};
  const Child=()=>{setups++;candidate=mountScene(template,[],[]);return candidate;};
  defineSceneComponent(Child,template,()=>[]);
  const parent:SceneTemplate={id:'ready-parent',nodes:[{kind:'element',tag:'main',parent:null,text:''},{kind:'element',tag:'button',parent:0,text:''},{kind:'region',parent:0}],slots:[],events:[{node:1,type:'click'}]};
  const root=f.app.mount(()=>mountScene(parent,[],[sceneEvent(()=>shown=!shown,['shown'])],{components:[Child],regions:[{node:2,sources:['shown'],branches:[Child,null],read:()=>({branch:shown?0:1,props:{}})}]}));
  await root.ready;expect(setups).toBe(0);f.reject();await rejection(root.dispatch(0));
  let ready=false;void candidate!.ready.then(()=>{ready=true;});await Promise.resolve();
  expect(ready).toBe(false);expect(candidate!.mounted).toBe(false);
  await root.flush();await candidate!.ready;expect(ready).toBe(true);expect(setups).toBe(1);expect(candidate!.mounted).toBe(true);
  await f.app.dispose();
});

it('preserves later props while a replacement is in flight, including rejected replacement',async()=>{
  for(const rejected of [false,true]) {
    const {App}=await load(source);const transactions:SceneTransaction[]=[];
    let arrived!:()=>void;const arrival=new Promise<void>(resolve=>{arrived=resolve;});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let blocked=false;
    const app=createDesktopApplication({async install(){},async commit(transaction){transactions.push(transaction);
      if(transaction.sequence===2&&!blocked){blocked=true;arrived();await gate;if(rejected)throw new Error('rejected replacement');}
      return {sequence:transaction.sequence};
    }});
    const root=app.mount(App);await root.ready;
    const first=root.dispatch(0).then(()=>undefined,error=>error as Error);await arrival;
    const candidate=transactions[1]!.operations[1]!.handle;
    const changed=root.dispatch(1);release();await Promise.all([first,changed]);
    const last=transactions.at(-1)!;expect(last.sequence).toBe(rejected?2:3);
    expect(last.operations.at(-1)).toMatchObject({kind:rejected?'mount':'update',handle:candidate,values:[{slot:0,value:'1'}]});
    await app.dispose();
  }
});

it('orders parent disposal after an in-flight replacement and cleans up its staged descendants',async()=>{
  for(const rejected of [false,true]) {
    const {App}=await load(source);const transactions:SceneTransaction[]=[];
    let arrived!:()=>void;const arrival=new Promise<void>(resolve=>{arrived=resolve;});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let blocked=false;
    const app=createDesktopApplication({async install(){},async commit(transaction){transactions.push(transaction);
      if(transaction.sequence===2&&!blocked){blocked=true;arrived();await gate;if(rejected)throw new Error('rejected replacement');}
      return {sequence:transaction.sequence};
    }});
    const root=app.mount(App);await root.ready;
    const first=root.dispatch(0).then(()=>undefined,error=>error as Error);await arrival;
    const candidate=transactions[1]!.operations[1]!.handle;
    const disposal=root.dispose();release();await Promise.all([first,disposal]);
    expect(transactions.at(-1)!.operations).toEqual([{kind:'dispose',handle:root.handle}]);
    expect(root.mounted).toBe(false);
    expect((await rejection(app.dispatch(candidate,0))).message).toContain('retired owner');
    await app.dispose();
  }
});

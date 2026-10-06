import { expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml, yukuEstreeFrontend, experimentalTsrxEstreeFrontend } from '@memoized-dom/compiler';
import { planInitialDom } from '../packages/compiler/src/emission/initial-dom';

const entry=`import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`;
function compile(source:string,options:Parameters<typeof compileModulesDetailed>[1]={}) {
  return compileModulesDetailed({'./main.ts':entry,'./App.tsx':source},{initialContent:true,...options});
}

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('proves request-only composition without inventing initial data (%s)',frontend=>{
  const result=compile(`import {$fetch as request} from '@memoized-dom/data';
    function Card({name}){return <section><h2 title={name}>{'Hello '+name}</h2></section>;}
    export function App(){const user=request('/api/user');return <main><h1>Directory</h1><Card name={user?.name}/></main>;}`,{frontend});
  expect(result.initialRender.kind).toBe('request');
  expect(emitInitialHtml(result.initialRender)).toBeNull();
  expect(result.initialDelivery?.browser).toBe('none');
  expect(result.initialDelivery).not.toHaveProperty('html');
  // Direct JS consumers retain the ordinary creation/mount ABI.
  expect(result.output['./main.ts']).not.toContain('mountInitial');
  expect(result.output['./App.tsx']).toContain('registerRootFactory');
});

it.each([
  `export function App(){const user=$fetch('/api/user');let node=null;return <h1 ref={node}>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');$effect(()=>{});return <h1>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');return <h1>{format(user)}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');return <main>{user?.show?<h1>One</h1>:null}</main>;}`,
  `export function App(){const user=$fetch('/api/user',{method:'POST',body:{}});return <h1>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user',{validate:{'~standard':{validate(){window.alert('side effect');}}}});return <h1>{user?.name}</h1>;}`,
  `function $fetch(){return {name:'fake'};}export function App(){return <h1>{$fetch().name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');return <input value={user?.name}/>;}`,
  `export function App(){const user=$fetch('/api/user');return <main route="/"><h1>{user?.name}</h1></main>;}`,
  `export function App(){const user=$routed(async()=>({name:'Ada'}));return <main route="/"><h1>{user.name}</h1></main>;}`,
  `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}export function App(){const user=$fetch('/api/user');return <Group pending={Pending}><h1>{user?.name}</h1></Group>;}`,
  `function Card({error}){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}function Error(){return <button onClick={()=>{}}>Retry</button>;}
    export function App(){return <Card error={Error}/>;}`,
])('retains browser work for unproved request behavior: %s',source=>{
  expect(compile(source).initialDelivery).toBeUndefined();
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds fixed fetched composition and restores data before mounting (%s)',frontend=>{
  const sources={
    './main.ts':`import {mount as attach} from '@memoized-dom/runtime';import {App} from './App';const _initialPayload=0;attach('root',App);`,
    './App.tsx':`import {Card} from './Card';export function App(){const user=$fetch('/api/user');let count=0;
      return <main><Card name={user?.name}/><button onClick={()=>count++}>{count}</button></main>;}`,
    './Card.tsx':`export function Card({name}){return <section><h2>{name}</h2><p>Kept</p></section>;}`,
  };
  const client=compileModulesDetailed(sources,{initialContent:true,frontend});
  const server=compileModulesDetailed(sources,{routedEnvironment:'server',moduleStateCells:true,frontend});
  expect(client.initialRender).toMatchObject({kind:'bindings',request:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  expect(client.initialDelivery).not.toHaveProperty('html');
  expect(client.output['./main.ts']).toContain('mountInitial as attach');
  expect(client.output['./main.ts']).toContain('initializePayload as _initialPayload_');
  expect(client.output['./main.ts']).toMatch(/attach\(['"]root['"], App, _initialPayload_\)/);
  expect(client.output['./App.tsx']).toContain('bindInitialNodes');
  expect(client.output['./Card.tsx']).toContain('bindInitialNodes');
  expect(client.output['./App.tsx']).not.toMatch(/createElement|materializeMarkup|createTextNode/);
  expect(client.output['./Card.tsx']).not.toMatch(/createElement|materializeMarkup|createTextNode/);
  expect(server.output['./App.tsx']).not.toContain('bindInitialNodes');
});

it('keeps fixed fetched text as a gated scalar binding without inventing presentation regions',()=>{
  const result=compile(`export function App(){const user=$fetch('/api/user');let count=0;
    return <main><h1>{user?.name}</h1><button onClick={()=>count++}>{count}</button></main>;}`);
  expect(result.initialRender).toMatchObject({kind:'bindings',request:true});
  expect(result.output['./App.tsx']).toContain('readResolvedValuesForRender');
  expect(result.output['./App.tsx']).not.toContain('createCondRegion');
  expect(result.output['./App.tsx']).not.toMatch(/materializeMarkup|createElement/);
});

it.each([
  `let rows=[{id:1}];return <main><h1>{user?.name}</h1><button onClick={()=>rows=[]}>Clear</button>{rows.map(row=><p key={row.id}>{row.id}</p>)}</main>;`,
])('keeps request structure on the general server placement contract: %s',body=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');${body}}`).initialDelivery).toBeUndefined();
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds request-selected host branches with one retained extent (%s)',frontend=>{
  const source=`export function App(){const user=$fetch('/api/user');let show=true;
    return <main><h1>{user?.name}</h1><button onClick={()=>show=!show}>Toggle</button>
      {user?.active && show?<section><h2>{user?.name}</h2></section>:<p>Hidden</p>}<footer>Kept</footer></main>;}`;
  const client=compile(source,{frontend});
  const server=compile(source,{frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialRender).toMatchObject({kind:'bindings',request:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  expect(client.initialDelivery).not.toHaveProperty('html');
  expect(client.output['./App.tsx']).toContain('bindInitialNodes');
  expect(client.output['./App.tsx']).not.toContain('bindInitialList');
  expect(server.output['./App.tsx']).not.toContain('bindInitialNodes');
  expect(server.output['./App.tsx']).toContain('mmd:initial:when:');
  expect(server.output['./App.tsx']).toContain('/mmd:initial:when');
});

it('binds a locally selected region alongside fetched text while retaining future creation',()=>{
  const result=compile(`export function App(){const user=$fetch('/api/user');let show=true;
    return <main><h1>{user?.name}</h1><button onClick={()=>show=!show}>Toggle</button>{show&&<p>Shown</p>}<footer>Kept</footer></main>;}`);
  expect(result.initialRender).toMatchObject({kind:'bindings',request:true});
  expect(result.initialDelivery?.browser).toBe('bindings');
  expect(result.output['./App.tsx']).toContain('createCondRegion');
  expect(result.output['./App.tsx']).toContain('createElement');
});

it('merges live and empty bindings in request-selected branches of repeated factories',()=>{
  const result=compile(`function Card({active,label}){return <section>{active?<p title={label}>{label}</p>:<b>Hidden</b>}</section>;}
    export function App(){const user=$fetch('/api/user');let n=0;return <main><button onClick={()=>n++}>Add</button>
      <Card active={user?.name==='Ada'} label=""/><Card active={user?.name==='Ada'} label={n}/></main>;}`);
  expect(result.initialRender.kind).toBe('bindings');
  if(result.initialRender.kind!=='bindings')throw new Error('Missing initial bindings');
  const factory=planInitialDom(result.initialRender)!.factories!['./App.tsx#Card']!;
  const branch=Object.values(factory.conditions)[0]!.branches![0]!;
  const paragraph=Object.values(branch.elements).find(element=>element.texts.length>0)!;
  expect(paragraph.staticAttributes).toEqual([]);
  expect(paragraph.texts).toMatchObject([{live:true,empty:true}]);
});

it.each([
  `{user?.active?<p>Shown</p>:null}`,
  `{user?.active?<p>Shown</p>:<><p>One</p><p>Two</p></>}`,
  `{user?.active?<p>{other&&<b>Nested</b>}</p>:<p>Hidden</p>}`,
])('retains general adoption for unproved request extents: %s',children=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');let other=true;
    return <main><button onClick={()=>other=!other}>Toggle</button>${children}</main>;}`).initialDelivery).toBeUndefined();
});

it('does not snapshot externally exposed objects or enable production delivery in development',()=>{
  const source=`export const config={title:'Directory'};export function App(){const user=$fetch('/api/user');return <h1>{config.title}{user?.name}</h1>;}`;
  expect(compile(source).initialDelivery).toBeUndefined();
  expect(compile(`export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`,{hot:true}).initialDelivery).toBeUndefined();
});

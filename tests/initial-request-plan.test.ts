import { expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml, yukuEstreeFrontend, experimentalTsrxEstreeFrontend } from '@memoized-dom/compiler';

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
  `export function App(){const user=$fetch('/api/user');return <h1 onClick={()=>{}}>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');let node=null;return <h1 ref={node}>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');$effect(()=>{});return <h1>{user?.name}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');return <h1>{format(user)}</h1>;}`,
  `export function App(){const user=$fetch('/api/user');return <main>{user?.show?<h1>One</h1>:<button onClick={()=>{}}>Two</button>}</main>;}`,
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

it('does not snapshot externally exposed objects or enable production delivery in development',()=>{
  const source=`export const config={title:'Directory'};export function App(){const user=$fetch('/api/user');return <h1>{config.title}{user?.name}</h1>;}`;
  expect(compile(source).initialDelivery).toBeUndefined();
  expect(compile(`export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`,{hot:true}).initialDelivery).toBeUndefined();
});

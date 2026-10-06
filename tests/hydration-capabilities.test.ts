import { expect, it } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';

function capabilities(source: string, modules: Record<string,string> = {}) {
  return compileModulesDetailed({
    './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    './App.tsx': source, ...modules,
  }).hydrationCapabilities;
}

it('omits list and markup adoption for a closed counter', () => {
  expect(capabilities(`export function App(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`))
    .toEqual({list:false,markup:false});
});

it.each(['item.id','index'])('retains adoption for %s rows in a composed factory', key => {
  expect(capabilities(`import {Rows} from './Rows';export function App(){return <Rows/>;}`, {
    './Rows.tsx': `export function Rows(){let items=[{id:1}];return <ul>{items.map((item,index)=><li key={${key}}>{item.id}</li>)}</ul>;}`,
  })).toEqual({list:true,markup:false});
});

it('includes markup required only by a later branch', () => {
  const cards=Array.from({length:24},(_,index)=>`<article><h2>Card ${index}</h2><p>Ready.</p></article>`).join('');
  expect(capabilities(`function Panel(){return <section>${cards}</section>;}export function App(){let show=false;return <main><button onClick={()=>show=!show}>Toggle</button>{show&&<Panel/>}</main>;}`))
    .toEqual({list:false,markup:true});
});

it.each([
  `import {widget} from 'external-widget';export function App(){widget();return <p>Ready</p>;}`,
  `import * as host from '@memoized-dom/runtime';export function App(){host.getActiveEnvironment();return <p>Ready</p>;}`,
  `export function App(){return <button onClick={()=>import('external-widget')}>Load</button>;}`,
])('keeps full support for open host code', source => {
  expect(capabilities(source)).toEqual({list:true,markup:true});
});

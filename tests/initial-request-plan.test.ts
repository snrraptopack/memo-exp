import { expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml, yukuEstreeFrontend, experimentalTsrxEstreeFrontend } from '@memoized-dom/compiler';
import { planInitialDom } from '../packages/compiler/src/emission/initial-dom';
import {sizeFixtures} from '../bench/package-size/fixtures';

const entry=`import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`;
it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds recreated component-owned request structures (%s)',frontend=>{
  const sources={'./main.ts':entry,...sizeFixtures['request-component-structures']!};
  const client=compileModulesDetailed(sources,{initialContent:true,frontend});
  const server=compileModulesDetailed(sources,{initialContent:true,frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  if(client.initialRender.kind!=='bindings')throw Error('Missing component structures');
  const row=planInitialDom(client.initialRender)!.factories!['./Row.tsx#Row']!;
  expect(row.retainCreation).toBe(true);
  const branch=Object.values(row.conditions)[0]!.branches![0]!;
  expect(Object.values(branch.lists)[0]).toMatchObject({count:null});
  expect(Object.values(branch.elements).flatMap(element=>element.texts).every(text=>text.live)).toBe(true);
  expect(client.output['./Row.tsx']).toContain('bindInitialList');
  expect(server.output['./Row.tsx']).toContain('mmd:initial:when:');
});
it.each(['missing branch','variable siblings'])('binds component request extents (%s)',shape=>{
  const sources={...sizeFixtures['request-component-structures']!};
  sources['./Row.tsx']=shape==='missing branch'
    ? sources['./Row.tsx']!.replace(':<aside>Hidden</aside>',':null')
    : sources['./Row.tsx']!.replace('</div><small>','{item.tags.map(tag=><strong key={tag.id}>{tag.label}</strong>)}</div><small>');
  expect(compileModulesDetailed({'./main.ts':entry,...sources},{initialContent:true}).initialDelivery?.browser).toBe('bindings');
});
it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds variable siblings and closed nested structures (%s)',frontend=>{
  for(const name of ['request-variable-extents','closed-nested-structures']) {
    const sources={'./main.ts':entry,...sizeFixtures[name]!};
    const client=compileModulesDetailed(sources,{initialContent:true,frontend});
    const server=compileModulesDetailed(sources,{initialContent:true,frontend,routedEnvironment:'server',moduleStateCells:true});
    expect(client.initialDelivery,JSON.stringify(client.initialRender)).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
    expect(client.output['./App.tsx']).toContain('bindInitialRegionNodes');
  }
});
function compile(source:string,options:Parameters<typeof compileModulesDetailed>[1]={}) {
  return compileModulesDetailed({'./main.ts':entry,'./App.tsx':source},{initialContent:true,...options});
}

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('proves fetched component row factories with future creation (%s)',frontend=>{
  const sources={
    './main.ts':entry,
    './App.tsx':`import {Row} from './Row';export function App(){const user=$fetch('/api/user');let n=0;return <main>
      <button onClick={()=>n++}>Next</button><ul>{user?.rows?.map((item,index)=><Row key={item.id} item={item} index={index} suffix={n}/>)}</ul></main>;}`,
    './Row.tsx':`export function Row({item,index,suffix}){let n=0;return <li><span>{index}:{item.label}:{suffix}</span><button onClick={()=>n++}>{n}</button></li>;}`,
  };
  const client=compileModulesDetailed(sources,{initialContent:true,frontend});
  const server=compileModulesDetailed(sources,{initialContent:true,frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  expect(client.output['./App.tsx']).toContain('bindInitialList');
  expect(client.output['./App.tsx']).not.toMatch(/materializeMarkup|createElement|createTextNode/);
  expect(client.output['./Row.tsx']).toContain('bindInitialNodes');
  expect(client.output['./Row.tsx']).toMatch(/materializeMarkup|createElement/);
  expect(server.output['./App.tsx']).toContain('mmd:initial:list:');
});

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
  `export function App(){const user=$fetch('/api/user');return <h1>{format(user)}</h1>;}`,
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

it.each([
  ['ref', `let node=null;return <h1 ref={node}>{user?.name}</h1>;`],
  ['effect', `$effect(()=>{});return <h1>{user?.name}</h1>;`],
])('retains %s ownership in a fetched initial binding', (feature,body)=>{
  const result=compile(`export function App(){const user=$fetch('/api/user');${body}}`);
  expect(result.initialRender).toMatchObject({kind:'bindings',request:true,owners:[{component:'App',features:[feature]}]});
  expect(result.initialDelivery?.browser).toBe('bindings');
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
])('binds closed local lists alongside fetched text: %s',body=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');${body}}`).initialDelivery?.browser).toBe('bindings');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend].flatMap(frontend=>['component','module'].map(placement=>({frontend,placement}))))('binds unknown fetched row counts in a dedicated host container (%j)',({frontend,placement})=>{
  const declaration=`const user=$fetch('/api/user');`;
  const source=`${placement==='module'?declaration:''}export function App(){${placement==='component'?declaration:''}let suffix='!';return <main>
    <h1>{user?.name}</h1><button onClick={()=>suffix+='!'}>Change</button>
    <ul>{user?.rows?.map((item,index)=><li key={item.id} title={item.label}>{index}:{item.label}{suffix}</li>)}</ul><footer>Kept</footer></main>;}`;
  const client=compile(source,{frontend});const server=compile(source,{frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  expect(client.initialDelivery).not.toHaveProperty('html');
  expect(client.output['./App.tsx']).toContain('bindInitialList');expect(server.output['./App.tsx']).toContain('mmd:initial:list:');
  expect(server.output['./App.tsx']).not.toContain('bindInitialList');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('retains event-only request tracking for a bound list (%s)',frontend=>{
  const result=compile(`export function App(){const user=$fetch('/api/user');const request=$track(user);
    return <main><button onClick={()=>request.refresh()}>Refresh</button><ul>{user?.rows?.map(item=><li key={item.id}>{item.label}</li>)}</ul></main>;}`,{frontend});
  expect(result.initialDelivery?.browser).toBe('bindings');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('keeps module-owned request selectors as bound conditional regions (%s)',frontend=>{
  const result=compile(`const user=$fetch('/api/user');export function App(){let show=true;
    return <main><button onClick={()=>show=!show}>Toggle</button>{user?.name==='Ada'&&show?<p>{user?.name}</p>:<b>Hidden</b>}</main>;}`,{frontend});
  expect(result.initialDelivery?.browser).toBe('bindings');
  expect(result.output['./App.tsx']).toContain('createCondRegion');
});

it.each([
  `'/api/user',{query:{id:7}}`, `'/api/user?id=7'`, `'/api/user',{headers:{authorization:'test'}}`,
  `'/api/user',{key:'user'}`, `'https://user:password@api.test/user'`,
])('retains adoption when an interactive fetch cannot transfer its snapshot: %s',input=>{
  expect(compile(`export function App(){const user=$fetch(${input});let n=0;
    return <main><button onClick={()=>n++}>{n}</button><h1>{user?.name}</h1></main>;}`).initialDelivery).toBeUndefined();
});

it('retains metadata presentation and shadowed tracking calls on ordinary browser creation',()=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');const request=$track(user);
    return <main><button onClick={()=>request.refresh()}>Retry</button>{request.pending?<p>Loading</p>:<h1>{user?.name}</h1>}</main>;}`).initialDelivery).toBeUndefined();
  expect(compile(`function $track(value){return value;}export function App(){const user=$fetch('/api/user');const request=$track(user);
    return <main><button onClick={()=>{}}>Change</button><h1>{user?.name}</h1></main>;}`).initialDelivery).toBeUndefined();
});

it.each([
  `<ul>{user?.rows?.map(({label})=><li>{label}</li>)}</ul>`,
])('retains general creation for unproved fetched row placement: %s',children=>{
  expect(compile(`function Card({text}){return <b>{text}</b>;}export function App(){const user=$fetch('/api/user');let show=true;
    return <main><button onClick={()=>show=!show}>Toggle</button>${children}</main>;}`).initialDelivery).toBeUndefined();
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds component descendants inside fetched host rows (%s)',frontend=>{
  const result=compile(`function Card({text}){return <b>{text}</b>;}export function App(){const user=$fetch('/api/user');let n=0;
    return <main><button onClick={()=>n++}>{n}</button><ul>{user?.rows?.map(item=><li><Card text={item.label}/></li>)}</ul></main>;}`,{frontend});
  expect(result.initialDelivery?.browser).toBe('bindings');
  expect(result.output['./App.tsx']).toContain('bindInitialList');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('plans fixed request-selected branches inside fetched rows (%s)',frontend=>{
  const source=`export function App(){const user=$fetch('/api/user');let n=0;return <main><button onClick={()=>n++}>{n}</button>
    <ul>{user?.rows?.map(item=><li key={item.id}>{item.active?<b>{item.label}</b>:<i>Hidden</i>}<span>{n}</span></li>)}</ul></main>;}`;
  const client=compile(source,{frontend}),server=compile(source,{frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  if(client.initialRender.kind!=='bindings')throw Error('Missing row bindings');
  const row=Object.values(planInitialDom(client.initialRender)!.lists)[0]!.row!;
  expect(Object.values(row.conditions)[0]).toMatchObject({branch:null,open:[0],end:[2]});
  expect(server.output['./App.tsx']).toContain('mmd:initial:when:');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('retains every request-selected descendant factory for later creation (%s)',frontend=>{
  const result=compile(`function Active({name}){let n=0;return <div><p>{name}</p><button onClick={()=>n++}>{n}</button></div>;}
    function Closed({name}){let n=0;return <article><p>{name}</p><button onClick={()=>n++}>{n}</button></article>;}
    export function App(){const user=$fetch('/api/user');const request=$track(user);return <main><button onClick={()=>request.refresh()}>Reload</button>
      {user?.active?<section><Active name={user.name}/></section>:<aside><Closed name={user?.name}/></aside>}</main>;}`,{frontend});
  expect(result.initialRender.kind).toBe('bindings');
  if(result.initialRender.kind!=='bindings')throw Error('Missing request branches');
  expect(result.initialRender.creationComponents).toEqual(expect.arrayContaining(['./App.tsx#Active','./App.tsx#Closed']));
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('binds fixed siblings around a variable fetched extent (%s)',frontend=>{
  const source=`export function App(){const user=$fetch('/api/user');let n=0;
    return <main><h1>Before</h1>{user?.rows?.map(item=><li key={item.id}>{item.label}</li>)}
      <button onClick={()=>n++}>{n}</button>{n}<footer>After</footer></main>;}`;
  const client=compile(source,{frontend}),server=compile(source,{frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  expect(client.output['./App.tsx']).toContain('bindInitialListNodes');
  expect(server.output['./App.tsx']).not.toContain('bindInitialListNodes');
  if(client.initialRender.kind!=='bindings')throw new Error('Missing bindings');
  const plan=planInitialDom(client.initialRender)!;
  expect(plan.pathMode).toBe('end');
  expect(Object.values(plan.lists)[0]!.end).toEqual([0,-4]);
});

it('uses ordinary addresses when the fetched list follows fixed siblings',()=>{
  const result=compile(`export function App(){const user=$fetch('/api/user');let n=0;
    return <main><button onClick={()=>n++}>{n}</button><ul>Before{user?.rows?.map(item=><li>{item.label}</li>)}</ul></main>;}`);
  expect(result.initialDelivery?.browser).toBe('bindings');
  expect(result.output['./App.tsx']).not.toContain('bindInitialListNodes');
});

it.each([yukuEstreeFrontend,experimentalTsrxEstreeFrontend])('proves nested fetched row extents and matching server anchors (%s)',frontend=>{
  const source=`export function App(){const user=$fetch('/api/user');let n=0;return <main><button onClick={()=>n++}>{n}</button>
    <ul>{user?.groups?.map(group=><li key={group.id}><h2>{group.name}</h2><ol>Before
      {group.rows.map((row,index)=><li key={row.id}>{index}:{row.label}:{n}</li>)}<footer>After {n}</footer></ol></li>)}</ul></main>;}`;
  const client=compile(source,{frontend}),server=compile(source,{frontend,routedEnvironment:'server',moduleStateCells:true});
  expect(client.initialDelivery).toMatchObject({browser:'bindings',key:server.initialDelivery?.key});
  if(client.initialRender.kind!=='bindings')throw new Error('Missing nested bindings');
  const outer=Object.values(planInitialDom(client.initialRender)!.lists)[0]!;
  expect(outer.count).toBeNull();expect(Object.values(outer.row!.lists)[0]).toMatchObject({count:null,end:[1,-2]});
  expect(server.output['./App.tsx'].match(/mmd:initial:list:/g)).toHaveLength(2);
});

it.each([
  `{group.rows.map(row=><li>{row.label}</li>)}{group.rows.map(row=><li>{row.label}</li>)}`,
  `{fixed.map(row=><li>{row.label}</li>)}`,
  `{group.rows.map(row=><li>{show&&<b>{row.label}</b>}</li>)}`,
])('binds nested variable and closed row extents: %s',children=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');let show=true;const fixed=[{label:'one'}];
    return <main><button onClick={()=>show=!show}>Toggle</button><ul>{user?.groups?.map(group=><li><ol>${children}</ol></li>)}</ul></main>;}`).initialDelivery?.browser).toBe('bindings');
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
  `{user?.active?<p>Shown</p>:<><p>One</p><p>Two</p></>}`,
])('retains general adoption for unproved request extents: %s',children=>{
  expect(compile(`export function App(){const user=$fetch('/api/user');let other=true;
    return <main><button onClick={()=>other=!other}>Toggle</button>${children}</main>;}`).initialDelivery).toBeUndefined();
});

it('does not snapshot externally exposed objects or enable production delivery in development',()=>{
  const source=`export const config={title:'Directory'};export function App(){const user=$fetch('/api/user');return <h1>{config.title}{user?.name}</h1>;}`;
  expect(compile(source).initialDelivery).toBeUndefined();
  expect(compile(`export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`,{hot:true}).initialDelivery).toBeUndefined();
});

import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, registeredIds, unregisterSubtree, setScheduler, resetScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';

const compileInitial: typeof compileModulesDetailed = (sources, options = {}) =>
  compileModulesDetailed(sources, { initialContent: true, ...options });

let app:MountedApplication|undefined;
afterEach(()=>{app?.unmount();app=undefined;for(const id of registeredIds())unregisterSubtree(id);resetScheduler();vi.restoreAllMocks();document.body.replaceChildren();});
function compile(source:string,modules:Record<string,string>={}) {
  const runtimePath='@memoized-dom/runtime/testing';
  return compileInitial({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source,...modules},{runtimePath});
}
async function bind(name:string,source:string,modules:Record<string,string>={}) {
  const result=compile(source,modules);
  expect(result.initialRender.kind).toBe('bindings');expect(result.initialContent).toBe(true);
  const directory=join(import.meta.dirname,'fixtures/out/initial-composition',name);mkdirSync(directory,{recursive:true});
  for(const [id,code] of Object.entries(result.output!))writeFileSync(join(directory,id),code);
  document.body.innerHTML=`<div id="root">${emitInitialHtml(result.initialRender)}</div>`;
  const original=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement'),text=vi.spyOn(document,'createTextNode');
  const {App}=await import(/* @vite-ignore */ pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());app=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect([...document.querySelectorAll('*')]).toEqual(original);
  expect(text.mock.calls.length).toBeLessThanOrEqual(emitInitialHtml(result.initialRender)!.match(/<!--mmd:empty-->/g)?.length??0);
  create.mockRestore();text.mockRestore();return result;
}
function click(selector:string) {document.querySelector<HTMLButtonElement>(selector)!.click();}

it.each([false,true])('keeps closed authored children in HTML without a browser slot (imported=%s)',async imported=>{
  const shell='function Shell({children}){return <section class="shell">{children}</section>;}';
  const result=await bind(`static-children-${imported}`,`${imported?"import {Shell} from './Shell';":shell}
    export function App(){const name='Ada';let n=0;return <main><button onClick={()=>n++}>{n}</button>
      <Shell><h2>Fixed caller content</h2><p title={name}>{name}</p></Shell></main>;}`,
    imported?{'./Shell.tsx':`export ${shell}`} : {});
  const section=document.querySelector('section'),content=[...section!.children];
  click('button');expect(document.querySelector('button')!.textContent).toBe('1');
  expect(document.querySelector('section')).toBe(section);expect([...section!.children]).toEqual(content);
  expect(section!.textContent).toBe('Fixed caller contentAda');
  expect(result.output['./App.tsx'].slice(result.output['./App.tsx'].indexOf('export function App')))
    .not.toMatch(/childrenMountSequence|Fixed caller content|createElement|materializeMarkup/);
});

it('keeps repeated static child extents and forwarding in their own HTML positions',async()=>{
  const result=await bind('static-children-forwarded',`function Frame({children}){return <aside>{children}</aside>;}
    function Shell({children}){return <section><Frame>{children}</Frame></section>;}
    export function App(){let n=0;return <main><button onClick={()=>n++}>{n}</button>
      <Shell><b>One</b></Shell><Shell><h2>Two</h2><p>Extra</p></Shell></main>;}`);
  const sections=[...document.querySelectorAll('section')],content=[...document.querySelectorAll('aside')];
  click('button');expect(document.querySelector('button')!.textContent).toBe('1');
  expect(content.map(node=>node.textContent)).toEqual(['One','TwoExtra']);
  expect([...document.querySelectorAll('section')]).toEqual(sections);
  expect([...document.querySelectorAll('aside')]).toEqual(content);
  expect(result.output['./App.tsx'].slice(result.output['./App.tsx'].indexOf('export function App')))
    .not.toMatch(/childrenMountSequence|materializeMarkup|createElement/);
});

it('keeps two mounts of the same closed slot as distinct retained nodes',async()=>{
  await bind('static-children-two-mounts',`function Shell({children}){return <section><aside>{children}</aside><article>{children}</article></section>;}
    export function App(){let n=0;return <main><button onClick={()=>n++}>{n}</button><Shell><b>Shared content</b></Shell></main>;}`);
  const nodes=[...document.querySelectorAll('b')];
  expect(nodes).toHaveLength(2);expect(nodes[0]).not.toBe(nodes[1]);
  click('button');expect([...document.querySelectorAll('b')]).toEqual(nodes);
  expect(nodes.map(node=>node.textContent)).toEqual(['Shared content','Shared content']);
});

it.each([
  ['live child', `let n=0;return <main><button onClick={()=>n++}>Next</button><Shell><b>{n}</b></Shell></main>;`],
  ['child event', `let n=0;return <main><Shell><button onClick={()=>n++}>{n}</button></Shell></main>;`],
  ['child ref', `let ref=null;let n=0;return <main><button ref={ref} onClick={()=>n++}>{n}</button><Shell><b ref={ref}>Ref</b></Shell></main>;`],
  ['future slot', `let show=false;return <main><button onClick={()=>show=!show}>Toggle</button><Shell><b>One</b></Shell>{show&&<Shell><b>Two</b></Shell>}</main>;`],
  ['future ancestor', `let show=false;return <main><button onClick={()=>show=!show}>Toggle</button><Card/>{show&&<Card/>}</main>;`],
])('retains the ordinary slot program for %s ownership',(_name,body)=>{
  const result=compile(`function Shell({children}){return <section>{children}</section>;}
    function Card(){return <article><Shell><b>Later</b></Shell></article>;}
    export function App(){${body}}`);
  expect(result.initialContent).toBe(false);
  expect(result.output['./App.tsx']).toContain('childrenMountSequence');
});

it('retains the slot program when the callee owns events',()=>{
  const result=compile(`function Shell({children}){let n=0;return <section><button onClick={()=>n++}>{n}</button>{children}</section>;}
    export function App(){return <main><Shell><b>Fixed</b></Shell></main>;}`);
  expect(result.initialRender.kind).not.toBe('bindings');expect(result.output['./App.tsx']).toContain('childrenMountSequence');
});

it('keeps repeated static/live props and empty text distinct while sharing their factory',async()=>{
  const result=await bind('repeated',`function Label({value='fallback'}){return <strong title={value}>{value}</strong>;}
    export function App(){let n=0;return <main><h1>Static surroundings</h1><button onClick={()=>n++}>Add</button>
      <Label value=""/><Label value={n}/><Label/></main>;}`);
  const labels=[...document.querySelectorAll('strong')];
  expect(labels.map(node=>node.textContent)).toEqual(['','0','fallback']);
  click('button');expect(labels.map(node=>node.textContent)).toEqual(['','1','fallback']);
  expect(labels.map(node=>node.getAttribute('title'))).toEqual(['','1','fallback']);
  expect([...document.querySelectorAll('strong')]).toEqual(labels);
  expect(result.output!['./App.tsx']).not.toMatch(/createElement|createTextNode|materializeMarkup|Static surroundings/);
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

it('binds nested imported aliases and retains derived prop updates',async()=>{
  const result=await bind('nested',`import {Counter} from './Counter';export function App(){return <main><Counter offset={2}/><Counter offset={10}/></main>;}`,{
    './Counter.tsx':`import {Value as Output} from './Value';export function Counter({offset}){let n=0;const doubled=n*2;const value=doubled+offset;
      return <section><button onClick={()=>n++}>Add</button><Output value={value}/></section>;}`,
    './Value.tsx':`export const Value=(props)=> <strong>{props.value}</strong>;`,
  });
  const buttons=[...document.querySelectorAll('button')],labels=[...document.querySelectorAll('strong')];
  expect(labels.map(node=>node.textContent)).toEqual(['2','10']);buttons[0]!.click();
  expect(labels.map(node=>node.textContent)).toEqual(['4','10']);buttons[1]!.click();
  expect(labels.map(node=>node.textContent)).toEqual(['4','12']);
  for(const id of ['./App.tsx','./Counter.tsx','./Value.tsx'])expect(result.output![id]).not.toMatch(/createElement|createTextNode|materializeMarkup/);
});

it('retains captured callback writes and sends coherent final props to children',async()=>{
  await bind('callbacks',`function Action({run}){return <button onClick={run}>Change</button>;}
    function Value({text}){return <p>{text}</p>;}
    export function App(){let n=0;let label='before';function change(){n++;label='after';}
      return <main><Action run={change}/><Value text={label+':'+n}/></main>;}`);
  const value=document.querySelector('p');click('button');expect(value!.textContent).toBe('after:1');
  click('button');expect(value!.textContent).toBe('after:2');expect(document.querySelector('p')).toBe(value);
});

it('retains imported module writes and object alias mutation after composition binding',async()=>{
  await bind('module',`import {name,change} from './state';import {Action} from './Action';
    function Value({text}){return <p>{text}</p>;}
    export function App(){const person={name:'Ada'};const alias=person;function rename(){alias.name='Grace';}
      return <main><h1>{name}</h1><Action run={change}/><Action run={rename}/><Value text={person.name}/></main>;}`,{
    './state.ts':`export let name='Ada';export function change(){name='Grace';}`,
    './Action.tsx':`export function Action({run}){return <button onClick={run}>Change</button>;}`,
  });
  const buttons=[...document.querySelectorAll('button')];buttons[0]!.click();
  expect(document.querySelector('h1')!.textContent).toBe('Grace');buttons[1]!.click();
  expect(document.querySelector('p')!.textContent).toBe('Grace');
});

it('binds structural regions relative to each composed instance and creates later rows',async()=>{
  await bind('lists',`function Todos({suffix}){let items=['one','two'];return <section><button onClick={()=>{items=[...items,'new'];}}>Add</button>
    <ul>{items.map((item,index)=><li key={index}>{item}{suffix}</li>)}</ul><p>After list</p></section>;}
    export function App(){return <main><Todos suffix="!"/><Todos suffix="?"/></main>;}`);
  const lists=[...document.querySelectorAll('ul')],first=[...lists[0]!.children],second=[...lists[1]!.children];
  click('button');expect([...lists[0]!.children].map(node=>node.textContent)).toEqual(['one!','two!','new!']);
  expect([...lists[0]!.children].slice(0,2)).toEqual(first);expect([...lists[1]!.children]).toEqual(second);
});

it.each([
  `function Label(){return <strong>Value</strong>;}export function App(){const escaped=Label;return <main><Label/><button onClick={()=>escaped()}>Call</button></main>;}`,
])('retains ordinary creation for an escaped factory',source=>{
  const result=compile(source);expect(result.initialContent).toBe(false);
  expect(result.output['./App.tsx']).toMatch(/materializeMarkup|createElement/);
});

it.each([false,true])('propagates retained creation through descendants (imported=%s) and refreshes formerly closed props',async imported=>{
  const card=`${imported?"import {Label} from './Label';":''}function Card({text}){return <section><Label text={text}/></section>;}`;
  const label=`function Label({text}){return <strong title={text}>{text}</strong>;}`;
  await bind(`future-descendants-${imported}`,`${imported?"import {Card} from './Card';":label+card}export function App(){let show=false;let text='later';
    return <main><button class="toggle" onClick={()=>show=!show}>Toggle</button>
      <button class="rename" onClick={()=>text='changed'}>Rename</button><Card text="initial"/>{show&&<Card text={text}/>}</main>;}`,
    imported?{'./Card.tsx':card.replace('function Card','export function Card'),'./Label.tsx':`export ${label}`} : {});
  const first=document.querySelector('section');click('.toggle');
  expect([...document.querySelectorAll('strong')].map(node=>node.textContent)).toEqual(['initial','later']);
  click('.rename');expect([...document.querySelectorAll('strong')].map(node=>node.textContent)).toEqual(['initial','changed']);
  expect(document.querySelectorAll('strong')[1]!.title).toBe('changed');
  click('.toggle');click('.toggle');
  expect([...document.querySelectorAll('strong')].map(node=>node.textContent)).toEqual(['initial','changed']);
  expect(document.querySelector('section')).toBe(first);
});

it('retains ordinary rendering when a recreated factory has unproved structural shape',()=>{
  const result=compile(`function Card({show}){return <section>{show?<b>One</b>:<i>Two</i>}</section>;}
    export function App(){let open=false;return <main><button onClick={()=>open=!open}>Toggle</button>
      <Card show={true}/>{open&&<Card show={false}/>}</main>;}`);
  expect(result.initialContent).toBe(false);
  expect(result.output['./App.tsx']).toMatch(/materializeMarkup|createElement/);
});

it.each([false,true])('clones retained creation markup without touching adopted nodes (show=%s)',async show=>{
  const cards=Array.from({length:24},(_,index)=>`<article><h2>Card ${index}</h2><p>Ready.</p></article>`).join('');
  const result=await bind(`future-markup-${show}`,`function Panel({value}){let clicks=0;return <section title={value}>
    <strong>{value}</strong><button class="child" onClick={()=>clicks++}>{clicks}</button>${cards}</section>;}
    export function App(){let show=${show};let n=1;return <main>
      <button class="toggle" onClick={()=>show=!show}>Toggle</button><button class="increment" onClick={()=>n++}>Increment</button>
      <Panel value={n}/>{show&&<Panel value={n+10}/>}</main>;}`);
  expect(result.output['./App.tsx']).toContain('materializeMarkup');
  const first=document.querySelector('section')!,cardsBefore=[...first.querySelectorAll('article')];
  first.querySelector<HTMLButtonElement>('.child')!.click();
  click('.increment');expect(first.title).toBe('2');
  expect(first.querySelector('strong')!.textContent).toBe('2');
  expect(first.querySelector('.child')!.textContent).toBe('1');
  expect([...first.querySelectorAll('article')]).toEqual(cardsBefore);
  click('.toggle');if(show)click('.toggle');
  const second=document.querySelectorAll('section')[1]!;
  expect(second.querySelectorAll('article')).toHaveLength(24);
  expect(second.title).toBe('12');expect(second.querySelector('.child')!.textContent).toBe('0');
  second.querySelector<HTMLButtonElement>('.child')!.click();
  click('.increment');expect(second.title).toBe('13');
  expect(second.querySelector('strong')!.textContent).toBe('13');
  expect(second.querySelector('.child')!.textContent).toBe('1');
  click('.toggle');expect(second.isConnected).toBe(false);click('.toggle');
  const recreated=document.querySelectorAll('section')[1]!;
  expect(recreated).not.toBe(second);expect(recreated.title).toBe('13');
  expect(recreated.querySelector('.child')!.textContent).toBe('0');
  expect(document.querySelector('section')).toBe(first);
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

it.each([false,true])('binds initial composition and creates future instances with show=%s',async show=>{
  const result=await bind(`future-${show}`,`function Label({value}){let clicks=0;return <section title={value}>
    <strong>{value}</strong><button class="child" onClick={()=>clicks++}>{clicks}</button></section>;}
    export function App(){let show=${show};let n=1;return <main><h1>Static surroundings</h1>
      <button class="toggle" onClick={()=>show=!show}>Toggle</button><button class="increment" onClick={()=>n++}>Increment</button>
      <Label value={n}/>{show&&<Label value={n+10}/>}</main>;}`);
  const first=document.querySelector('section')!;
  expect([...document.querySelectorAll('strong')].map(node=>node.textContent)).toEqual(show?['1','11']:['1']);
  click('.increment');expect(first.textContent).toBe('20');expect(first.title).toBe('2');
  click('.toggle');if(show) click('.toggle');
  const second=document.querySelectorAll('section')[1]!;
  expect(second.textContent).toBe('120');expect(second.title).toBe('12');
  second.querySelector('button')!.click();expect(second.textContent).toBe('121');
  click('.increment');expect(first.textContent).toBe('30');expect(second.textContent).toBe('131');
  click('.toggle');expect(second.isConnected).toBe(false);
  click('.toggle');expect(document.querySelectorAll('section')[1]!.textContent).toBe('130');
  expect(document.querySelector('section')).toBe(first);
  expect(result.output['./App.tsx']).not.toContain('Static surroundings');
  app!.unmount();app=undefined;expect(registeredIds()).toEqual([]);
});

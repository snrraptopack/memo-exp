import { afterEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { mount, registeredIds, unregisterSubtree, setScheduler, resetScheduler,
  type MountedApplication } from '@memoized-dom/runtime/testing';

let app: MountedApplication | undefined;
afterEach(() => {
  app?.unmount(); app = undefined;
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler(); document.body.replaceChildren();
});

it('keeps a named helper at factory scope when passed from nested inline rows',async()=>{
  const result=compileModules({
    './main.ts':`import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);`,
    './App.tsx':`function Action({item,run}){return <button onClick={()=>run(item)}>Change</button>;}
      export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];const change=item=>{item.label+='!';return item.label;};
      return <main>{items.map(item=><li key={item.id}><Action item={item} run={change}/><span>{item.label}</span></li>)}</main>;}`,
  },{runtimePath:'@memoized-dom/runtime/testing'});
  const directory=join(import.meta.dirname,'fixtures/out/named-prop-callbacks/nested-row-helper');mkdirSync(directory,{recursive:true});
  for(const [id,code] of Object.entries(result))writeFileSync(join(directory,id),code);
  document.body.innerHTML='<div id="root"></div>';
  const {App}=await import(/* @vite-ignore */ pathToFileURL(join(directory,'App.tsx')).href);
  setScheduler(run=>run());app=mount('root',App);
  const rows=[...document.querySelectorAll('li')],button=rows[1]!.querySelector<HTMLButtonElement>('button')!;
  expect(button.onclick!.call(button,new MouseEvent('click'))).toBe('two!');
  expect([...document.querySelectorAll('li')]).toEqual(rows);
  expect(rows.map(row=>row.querySelector('span')!.textContent)).toEqual(['one','two!']);
});

it.each(['run', 'props.run', 'event => run(event)', 'event => props.run(event)'])(
  'routes imported named callback writes through forwarding props: %s', async handler => {
    const object = handler.includes('props.');
    const result = compileModules({
      './main.ts': `import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);`,
      './App.tsx': `import {name,change} from './state'; import {Forward} from './Forward';
        export function App(){return <main><h1>{name}</h1><Forward run={change}/></main>;}`,
      './state.ts': `export let name='Ada';export function change(){name='Grace';return 42;}`,
      './Forward.tsx': `import {Action} from './Action';export function Forward({run}){return <section><Action run={run}/></section>;}`,
      './Action.tsx': `export function Action(${object ? 'props' : '{run}'}){return <button onClick={${handler}}>Change</button>;}`,
    }, { runtimePath: '@memoized-dom/runtime/testing' });
    const directory = join(import.meta.dirname, 'fixtures/out/named-prop-callbacks', handler.replace(/\W/g, '_'));
    mkdirSync(directory, { recursive: true });
    for (const [id, code] of Object.entries(result)) writeFileSync(join(directory, id), code);
    document.body.innerHTML = '<div id="root"></div>';
    const { App } = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'App.tsx')).href);
    setScheduler(run => run()); app = mount('root', App);
    const heading = document.querySelector('h1');
    const button = document.querySelector<HTMLButtonElement>('button')!;
    expect(button.onclick!.call(button, new MouseEvent('click'))).toBe(42);
    expect(heading!.textContent).toBe('Grace');
    expect(document.querySelector('h1')).toBe(heading);
  },
);

it('does not commit a throwing callback and preserves the authored error', async () => {
  const result = compileModules({
    './main.ts': `import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);`,
    './App.tsx': `import {name,change} from './state';function Action({run}){return <button onClick={run}>Change</button>;}
      export function App(){return <main><h1>{name}</h1><Action run={change}/></main>;}`,
    './state.ts': `export let name='Ada';export function change(){name='Grace';throw undefined;}`,
  }, { runtimePath: '@memoized-dom/runtime/testing' });
  const directory = join(import.meta.dirname, 'fixtures/out/named-prop-callbacks/throw');
  mkdirSync(directory, { recursive: true });
  for (const [id, code] of Object.entries(result)) writeFileSync(join(directory, id), code);
  document.body.innerHTML = '<div id="root"></div>';
  const { App } = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'App.tsx')).href);
  setScheduler(run => run()); app = mount('root', App);
  const button = document.querySelector<HTMLButtonElement>('button')!;
  let threw = false;
  try { button.onclick!.call(button, new MouseEvent('click')); }
  catch (error) { threw = true; expect(error).toBeUndefined(); }
  expect(threw).toBe(true);
  expect(document.querySelector('h1')!.textContent).toBe('Ada');
});

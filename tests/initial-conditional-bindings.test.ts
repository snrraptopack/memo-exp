import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, registeredIds, unregisterSubtree, resetScheduler, setScheduler,
  type MountedApplication } from '@memoized-dom/runtime/testing';

const compileInitial: typeof compileModulesDetailed = (sources, options = {}) =>
  compileModulesDetailed(sources, { initialContent: true, ...options });

const directory=join(import.meta.dirname,'fixtures/out/initial-conditions');
let app:MountedApplication|undefined;
afterEach(()=>{
  app?.unmount();app=undefined;
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();vi.restoreAllMocks();document.body.replaceChildren();
});
function compile(source:string) {
  const runtimePath='@memoized-dom/runtime/testing';
  return compileInitial({'./main.ts':`import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
    './App.tsx':source},{runtimePath});
}
async function mount(name:string,source:string) {
  const result=compile(source);expect(result.initialRender.kind).toBe('bindings');
  const html=emitInitialHtml(result.initialRender);expect(html).not.toBeNull();
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,`${name}.ts`),result.output!['./App.tsx']!);
  document.body.innerHTML=`<div id="root">${html}</div>`;
  const original=[...document.querySelectorAll('*')];
  const create=vi.spyOn(document,'createElement'), text=vi.spyOn(document,'createTextNode');
  const specifier=`./fixtures/out/initial-conditions/${name}.ts`;const {App}=await import(specifier);
  setScheduler(run=>run());app=mountInitial('root',App);
  expect(create).not.toHaveBeenCalled();expect(text).not.toHaveBeenCalled();
  expect([...document.querySelectorAll('*')]).toEqual(original);
  create.mockRestore();text.mockRestore();return result;
}

it('binds initial branches and uses the same factory when returning to them',async()=>{
  const result=await mount('active',`export function App(){let open=true;let n=1;const title='Kept title';return <main>
    <h1>Static surrounding heading</h1><button class="toggle" onClick={()=>{open=!open;}}>Toggle</button>
    {open?<section title={title}><b>Branch label</b><button class="add" onClick={()=>n++}>{n}</button></section>:<p>Closed</p>}
    <span>{n}</span></main>;}`);
  const main=document.querySelector('main'), heading=document.querySelector('h1'), initial=document.querySelector('section');
  expect(result.output!['./App.tsx']).not.toContain('Static surrounding heading');
  document.querySelector<HTMLButtonElement>('.add')!.click();
  expect(document.querySelector('section')).toBe(initial);expect(document.querySelector('.add')!.textContent).toBe('2');
  document.querySelector<HTMLButtonElement>('.toggle')!.click();expect(document.querySelector('section')).toBeNull();
  expect(document.querySelector('p')!.textContent).toBe('Closed');
  document.querySelector<HTMLButtonElement>('.toggle')!.click();
  expect(document.querySelector('section')).not.toBe(initial);expect(document.querySelector('section')!.getAttribute('title')).toBe('Kept title');
  expect(document.querySelector('b')!.textContent).toBe('Branch label');expect(document.querySelector('.add')!.textContent).toBe('2');
  document.querySelector<HTMLButtonElement>('.add')!.click();expect(document.querySelector('span')!.textContent).toBe('3');
  expect(document.querySelector('main')).toBe(main);expect(document.querySelector('h1')).toBe(heading);
});

it('places empty and independent regions without corrupting later text addresses',async()=>{
  await mount('empty',`export function App(){let show=false;let n=0;return <main>
    <button class="show" onClick={()=>{show=!show;}}>Show</button>
    {show&&<p title={'n'+n}>{n}</p>}{n}<button class="add" onClick={()=>n++}>Add</button>
    {n===0?<i>zero</i>:n===1?<b>one</b>:<strong>{n}</strong>}{n}</main>;}`);
  const main=document.querySelector('main')!;const textNodes=[...main.childNodes].filter(node=>node.nodeType===3);
  expect(textNodes.map(node=>node.textContent)).toEqual(['0','0']);
  document.querySelector<HTMLButtonElement>('.show')!.click();expect(document.querySelector('p')!.textContent).toBe('0');
  document.querySelector<HTMLButtonElement>('.add')!.click();expect(document.querySelector('b')!.textContent).toBe('one');
  expect(document.querySelector('p')!.getAttribute('title')).toBe('n1');expect(textNodes.map(node=>node.textContent)).toEqual(['1','1']);
  document.querySelector<HTMLButtonElement>('.add')!.click();expect(document.querySelector('strong')!.textContent).toBe('2');
  expect(textNodes.every(node=>node.parentNode===main)).toBe(true);
});

it('retains module-state routing for the bound region entity',async()=>{
  await mount('module',`let n=0;export function App(){return <main><button onClick={()=>n++}>Next</button>
    {n===0?<p>zero</p>:<p>{n}</p>}</main>;}`);
  document.querySelector<HTMLButtonElement>('button')!.click();expect(document.querySelector('p')!.textContent).toBe('1');
  const retained=document.querySelector('p');document.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('p')).toBe(retained);expect(retained!.textContent).toBe('2');
});

it.each([
  `<section><div>{show?<p>nested</p>:null}</div></section>`,
  `<section>{Date.now()}</section>`,
  `<section {...{title:'spread'}}>spread</section>`,
])('retains general creation for unproved branch semantics: %s',branch=>{
  const result=compile(`export function App(){let show=true;return <main><button onClick={()=>{show=!show;}}>Toggle</button>{show?${branch}:null}</main>;}`);
  expect(result.initialContent).toBe(false);
});

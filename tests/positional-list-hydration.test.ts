import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { renderToString } from '@memoized-dom/server';
import { mount, registerRootFactory, resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';

const directory=join(import.meta.dirname,'fixtures/out/positional-hydration');
mkdirSync(directory,{recursive:true});
const source=`export function App(){let items=['a','b','b'];return <main>
  <button class="reverse" onClick={()=>{items=[...items].reverse();}}>Reverse</button>
  <button class="clear" onClick={()=>{items=[];}}>Clear</button>
  <button class="append" onClick={()=>{items=[...items,'b'];}}>Append</button>
  <ul>{items.map((item,index)=><li key={index}>{index}:{item}</li>)}</ul></main>;}`;
const code=compile(source);
writeFileSync(join(directory,'app.ts'),code);
writeFileSync(join(directory,'keyed.ts'),compile(source.replace('key={index}', 'key={index + 0}')));
let mounted:MountedApplication|undefined;
beforeEach(()=>{document.body.replaceChildren();setScheduler(run=>run());});
afterEach(()=>{mounted?.unmount();mounted=undefined;resetScheduler();vi.restoreAllMocks();});

async function setup(html?: (value:string)=>string, positional=true) {
  const specifier=positional?'./fixtures/out/positional-hydration/app.ts':'./fixtures/out/positional-hydration/keyed.ts'; const {App}=await import(specifier);
  registerRootFactory(App,{id:'App',create:()=>App('App',null)});
  const host=document.createElement('div');host.id='root';
  const output=renderToString(App,{markers:true});host.innerHTML=html?html(output):output;
  document.body.append(host);return {App,host,output};
}

it.each([true,false])('adopts index markers and keeps append/clear/reinsert correct (positional=%s)',async positional=>{
  expect(code).toContain('.createPositionalListRegion(');
  const {App,host,output}=await setup(undefined,positional);
  expect(output).toContain('mmd:w:App/items:n:0');expect(output).toContain('mmd:w:App/items:n:2');
  const original=[...host.querySelectorAll('li')], list=host.querySelector('ul')!;
  const create=vi.spyOn(document,'createElement'), insert=vi.spyOn(list,'insertBefore');
  mounted=mount('root',App);
  expect(create).not.toHaveBeenCalled();expect(insert).not.toHaveBeenCalled();
  host.querySelector<HTMLButtonElement>('.reverse')!.click();
  expect([...host.querySelectorAll('li')]).toEqual(original);
  expect(original.map(node=>node.textContent)).toEqual(['0:b','1:b','2:a']);
  host.querySelector<HTMLButtonElement>('.append')!.click();expect(host.querySelectorAll('li')).toHaveLength(4);
  host.querySelector<HTMLButtonElement>('.clear')!.click();expect(host.querySelectorAll('li')).toHaveLength(0);
  host.querySelector<HTMLButtonElement>('.append')!.click();expect(host.querySelector('li')!.textContent).toBe('0:b');
});

it.each([true,false])('uses shared recovery for incorrect index markers (positional=%s)',async positional=>{
  const onHydrateError=vi.fn();
  const {App,host}=await setup(output=>output.replace('mmd:w:App/items:n:1','mmd:w:App/items:n:9'),positional);
  mounted=mount('root',App,{onHydrateError});
  expect(onHydrateError).toHaveBeenCalled();
  expect([...host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:a','1:b','2:b']);
});

it.each([true,false])('recovers additional server rows and keeps later insertions working (positional=%s)',async positional=>{
  const onHydrateError=vi.fn();
  const {App,host}=await setup(output=>output.replace('<!--/mmd--></ul>',
    '<!--mmd:w:App/items:n:3--><li>3:unexpected</li><!--/mmd--></ul>'),positional);
  mounted=mount('root',App,{onHydrateError});
  expect(onHydrateError).toHaveBeenCalledOnce();
  expect(onHydrateError.mock.calls[0]![0].message).toContain('additional server row content');
  expect([...host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:a','1:b','2:b']);
  host.querySelector<HTMLButtonElement>('.append')!.click();
  expect([...host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:a','1:b','2:b','3:b']);
});

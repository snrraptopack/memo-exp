import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { mountInitial, resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { registerRootFactory, rootFactoryStore } from '@memoized-dom/runtime/server';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';
import { registeredIds } from '@memoized-dom/runtime/testing';
import { render, renderToReadableStream, serve } from '../src/index';

const compileInitial: typeof compileModulesDetailed = (sources, options = {}) =>
  compileModulesDetailed(sources, { initialContent: true, ...options });

const entry = `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`;
let mounted: ReturnType<typeof mountInitial> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; resetScheduler(); document.body.innerHTML = ''; });

async function fixture(name: string, source: string) {
  const sources = { './main.ts': entry, './App.tsx': source };
  const server = compileInitial(sources, { routedEnvironment: 'server', moduleStateCells: true });
  const client = compileInitial(sources, { routedEnvironment: 'client' });
  const directory = join(import.meta.dirname, 'fixtures/out/initial-delivery', name);
  mkdirSync(directory, { recursive: true });
  const serverFile = join(directory, 'server.ts');
  const clientFile = join(directory, 'client.ts');
  writeFileSync(serverFile, server.output['./App.tsx']!);
  writeFileSync(clientFile, client.output['./App.tsx']!);
  return { server, client,
    serverModule: await import(/* @vite-ignore */ pathToFileURL(serverFile).href),
    clientModule: await import(/* @vite-ignore */ pathToFileURL(clientFile).href),
  };
}

describe('shared initial server delivery', () => {
  it('renders immutable locals and composition without running their server factories or sending a payload', async () => {
    const value = await fixture('static', `function Card({name}) {return <section><h2>{name}</h2></section>;}
      export function App(){let name='Ada & <friends>';const greeting='Hello '+name;return <main><Card name={greeting}/></main>;}`);
    const contract = value.server.initialDelivery!;
    expect(contract.browser).toBe('none');
    expect(contract.key).toBe(value.client.initialDelivery?.key);
    expect(value.client.output['./App.tsx']).not.toContain('initialDelivery');
    let calls = 0;
    const observed = (id: string, parent: null) => { calls++; return value.serverModule.App(id, parent); };
    registerRootFactory(observed, rootFactoryStore().get(value.serverModule.App)!);
    const result = await render(observed, { initialKey: contract.key, markers: true, mode: 'resolve' });
    expect(result.html).toBe(emitInitialHtml(value.client.initialRender));
    expect(result.html).toContain('Hello Ada &amp; &lt;friends&gt;');
    expect(result.scriptTag).toBe('');
    expect(result.payload).toEqual({ version: 1 });
    expect(calls).toBe(0);
    const ordinary = await render(observed);
    expect(ordinary.html).toBe(result.html);
    expect(calls).toBe(1);
    const stream = renderToReadableStream(observed, { initialKey: contract.key, markers: true });
    expect(await new Response(stream).text()).toBe(result.html);
    expect(calls).toBe(1);
  });

  it('binds server HTML once, retains node identity and creates only later rows and branches', async () => {
    const value = await fixture('interactive', `export function App(){let n=0;let open=true;let items=[];
      return <main><h1>Static shell</h1><button class="add" onClick={()=>{n++;items=[...items,n];}}>Add</button>
      <button class="toggle" onClick={()=>open=!open}>Toggle</button><p>{n}</p>
      {open?<section><b>{n}</b></section>:<i>Closed</i>}
      <ul>{items.map((item,index)=><li key={index}>{index}:{item}</li>)}</ul></main>;}`);
    const contract = value.server.initialDelivery!;
    expect(contract.browser).toBe('bindings');
    expect(contract.key).toBe(value.client.initialDelivery?.key);
    const responses = await Promise.all([0, 1].map(() => render(value.serverModule.App, { initialKey: contract.key })));
    expect(responses[0]!.html).toBe(responses[1]!.html);
    document.body.innerHTML = `<div id="root">${responses[0]!.html}</div>`;
    const heading = document.querySelector('h1');
    const button = document.querySelector<HTMLButtonElement>('.add')!;
    const section = document.querySelector('section');
    setScheduler(run => run());
    mounted = mountInitial('root', value.clientModule.App);
    expect(document.querySelector('section')).toBe(section);
    button.click();
    expect(document.querySelector('p')?.textContent).toBe('1');
    expect(document.querySelector('li')?.textContent).toBe('0:1');
    expect(document.querySelector('section')).toBe(section);
    document.querySelector<HTMLButtonElement>('.toggle')!.click();
    expect(document.querySelector('i')?.textContent).toBe('Closed');
    document.querySelector<HTMLButtonElement>('.toggle')!.click();
    expect(document.querySelector('b')?.textContent).toBe('1');
    expect(document.querySelector('h1')).toBe(heading);
    expect(document.querySelector('.add')).toBe(button);
    mounted.unmount(); mounted = undefined;
    expect(registeredIds()).toEqual([]);
  });

  it('rejects stale client contracts before invoking a server factory', async () => {
    const value = await fixture('stale', 'export function App(){return <h1>Hello</h1>;}');
    await expect(render(value.serverModule.App, { initialKey: 'stale-build' })).rejects.toThrow('contracts do not match');
    const changed = compileInitial({ './main.ts': entry, './App.tsx': 'export function App(){return <h1>Updated</h1>;}' });
    expect(changed.initialDelivery?.key).not.toBe(value.server.initialDelivery?.key);
    expect((await render(value.serverModule.App)).html).toBe('<h1>Hello</h1>');
  });

  it.each(['stream', 'buffer'] as const)('delivers the matching root with %s delivery and rejects a mismatched server build', async delivery => {
    const first = await fixture(`selected-${delivery}`, `export function App(){return <h1>Selected root</h1>;}`);
    const other = await fixture(`other-${delivery}`, `export function App(){return <h1>Other root</h1>;}`);
    const key = first.server.initialDelivery!.key;
    const template = `<!doctype html><head></head><body><div id="root"><!--ssr-outlet--></div></body>` +
      initialBootstrapDescriptor({ key, target: 'root', browser: 'none' });
    const application = serve();
    application.ssr(first.serverModule.App, { delivery });
    application.ssr('/other', other.serverModule.App, { delivery });
    (application as unknown as { installDocumentTemplate(template: string): void }).installDocumentTemplate(template);
    const selected = await (await application.fetch(new Request('https://app.test/'))).text();
    expect(selected).toContain('<h1>Selected root</h1>');
    expect(selected).not.toMatch(/script|modulepreload|mmd:r:/);
    const mismatch = await application.fetch(new Request('https://app.test/other'));
    expect(mismatch.status).toBe(500);
    expect(await mismatch.text()).not.toContain('<h1>Other root</h1>');
  });

  it.each([
    `export const value={name:'Ada'};export function App(){return <h1>{value.name}</h1>;}`,
    `let name='Ada';export function change(){name='Grace';}export function App(){return <h1>{name}</h1>;}`,
    `const value={get name(){return 'Ada';}};export function App(){return <h1>{value.name}</h1>;}`,
    `export function App(){const data=$fetch('/api/name');let n=0;return <main>{data.name?<h1>{data.name}</h1>:null}<button onClick={()=>n++}>{n}</button></main>;}`,
    `export function App(){let n=0;$effect(()=>n++);return <h1>{n}</h1>;}`,
  ])('keeps request-dependent or externally writable roots on ordinary SSR: %s', source => {
    const compiled = compileInitial({ './main.ts': entry, './App.tsx': source }, { routedEnvironment: 'server' });
    expect(compiled.initialDelivery).toBeUndefined();
    expect(compiled.output['./App.tsx']).not.toContain('initialDelivery');
  });

  it('allows an exported primitive that is never written', () => {
    const compiled = compileInitial({ './main.ts': entry,
      './App.tsx': `export let name='Ada';export function App(){return <h1>{name}</h1>;}` }, { routedEnvironment: 'server' });
    expect(compiled.initialDelivery?.browser).toBe('none');
  });
});

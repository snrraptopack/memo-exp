import { waitFor, type FetchStub } from '../../../test-support/helpers';
// Runs with Bun globals; no DOM preload.
/** Request-only delivery uses the production async request storage. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';
import { render, renderToString, renderToReadableStream, serve } from '../src/index';
import { StringDocument, type StringRenderableNode } from '../src/string-document';

const entry = `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`;
async function fixture(name: string, source: string) {
  const sources = { './main.ts': entry, './App.tsx': source };
  const server = compileModulesDetailed(sources, { initialContent: true, routedEnvironment: 'server', moduleStateCells: true });
  const client = compileModulesDetailed(sources, { initialContent: true, routedEnvironment: 'client' });
  const directory = join(import.meta.dirname, 'fixtures/out/initial-request', name);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'server.ts');
  writeFileSync(file, server.output['./App.tsx']!);
  return { server, client, serverModule: await import(/* @vite-ignore */ pathToFileURL(file).href) };
}

describe('request-only server delivery', () => {
  it.each(['', 'Ada'])('preserves request availability before a non-optional selector and local counter (%s)',async name=>{
    const value=await fixture(`conditional-counter-${name || 'empty'}`,
      `export function App(){const data=$fetch('/api/name');let n=0;return <main>{data.name?<h1>{data.name}</h1>:null}<button onClick={()=>n++}>{n}</button></main>;}`);
    expect(value.server.initialDelivery).toBeUndefined();
    expect(value.client.initialDelivery).toBeUndefined();
    let calls=0;
    const fetch=(async()=>{calls++;return Response.json({name});}) as typeof globalThis.fetch;
    const result=await render(value.serverModule.App,{fetch,mode:'resolve',markers:true});
    expect(result.settlement.status).toBe('complete');
    expect(result.html).not.toContain('mmd:initial:when');
    const expected=`<main>${name?'<h1>Ada</h1>':''}<button>0</button></main>`;
    expect(result.html.replace(/<!--[^]*?-->/g,'')).toBe(expected);
    expect(result.payload.state?.sources).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it.each([0,2])('settles a fetched list of %s rows with source anchors for bindings and general markers otherwise',async count=>{
    const value=await fixture(`fetched-list-${count}`,`export function App(){const user=$fetch('/api/user');let suffix='!';
      return <main><h1>{user?.name}</h1><button onClick={()=>suffix+='!'}>Change</button>
        <ul>{user?.rows?.map((item,index)=><li key={item.id}>{index}:{item.label}{suffix}</li>)}</ul><footer>Kept</footer></main>;}`);
    const contract=value.server.initialDelivery!;
    expect(contract).toMatchObject({browser:'bindings',key:value.client.initialDelivery?.key});
    const rows=[{id:1,label:'one'},{id:2,label:'two'}].slice(0,count);
    const fetch=(async()=>Response.json({name:'Ada',rows})) as typeof globalThis.fetch;
    const options={initialKey:contract.key,fetch,mode:'shell' as const};
    const result=await render(value.serverModule.App,options);
    expect(result.settlement.status).toBe('complete');expect(result.html).toContain('<!--mmd:initial:list:');
    expect(result.html).toContain('<!--/mmd:initial:list-->');expect(result.html).not.toMatch(/mmd:[rglw]:/);
    expect(result.html.match(/<li>/g)?.length??0).toBe(count);
    if(count)expect(result.html).toContain('<li>0:one!</li><li>1:two!</li>');
    expect(await new Response(renderToReadableStream(value.serverModule.App,options)).text()).toBe(result.html+result.scriptTag);
    const ordinary=await render(value.serverModule.App,{mode:'resolve',markers:true,fetch});
    expect(ordinary.html).toContain('mmd:l:');expect(ordinary.html).not.toContain('mmd:initial:list');
    expect(ordinary.html.replace(/<!--[^]*?-->/g,'')).toBe(result.html.replace(/<!--[^]*?-->/g,''));
  });

  it.each(['Ada','Other'])('settles request-selected regions with contract-only anchors (%s)',async name=>{
    const value=await fixture(`request-condition-${name}`,`export function App(){const user=$fetch('/api/user');let show=true;
      return <main><h1>{user?.name}</h1><button onClick={()=>show=!show}>Toggle</button>
        {user?.name==='Ada' && show?<section><h2>{user?.name}</h2></section>:<p>Hidden</p>}<footer>Kept</footer></main>;}`);
    const contract=value.server.initialDelivery!;
    expect(contract).toMatchObject({browser:'bindings',key:value.client.initialDelivery?.key});
    const fetch=(async()=>Response.json({name})) as typeof globalThis.fetch;
    const result=await render(value.serverModule.App,{initialKey:contract.key,fetch,mode:'shell'});
    expect(result.settlement.status).toBe('complete');
    expect(result.html).toContain('<!--mmd:initial:when:');
    expect(result.html).toContain('<!--/mmd:initial:when-->');
    expect(result.html).toContain(name==='Ada'?'<section><h2>Ada</h2></section>':'<p>Hidden</p>');
    expect(result.html).not.toMatch(/mmd:[rgl]:/);
    expect(result.payload.state?.sources).toHaveLength(1);
    expect(await new Response(renderToReadableStream(value.serverModule.App,{initialKey:contract.key,fetch,mode:'shell'})).text())
      .toBe(result.html+result.scriptTag);
    const ordinary=await render(value.serverModule.App,{mode:'resolve',markers:true,fetch});
    expect(ordinary.html).toContain('mmd:g:');
    expect(ordinary.html).not.toContain('mmd:initial:when');
    expect(ordinary.html.replace(/<!--[^]*?-->/g,'')).toBe(result.html.replace(/<!--[^]*?-->/g,''));
  });

  it('emits reserved initial conditional comments only for a binding contract',()=>{
    const document=new StringDocument();
    for(const data of ['mmd:initial:when:1:2','/mmd:initial:when','mmd:initial:list:1:2','/mmd:initial:list']) {
      const node=document.createComment(data) as unknown as StringRenderableNode;
      expect(node.toString(false,true)).toBe(`<!--${data}-->`);
      expect(node.toString(false,false)).toBe('');expect(node.toString(true,false)).toBe('');
    }
    const normal=document.createComment('mmd:g:App/when0') as unknown as StringRenderableNode;
    expect(normal.toString(false,true)).toBe('');expect(normal.toString(true,false)).toContain('mmd:g:');
  });

  it('delivers settled interactive bindings and empty text addresses for results and streams',async()=>{
    const value=await fixture('request-bindings',`
      export function Card({name}){return <section><h2>{name}</h2><p>Kept</p></section>;}
      export function App(){const user=$fetch('/api/user');let count=0;return <main><Card name={user?.name}/><button onClick={()=>count++}>{count}</button></main>;}`);
    const contract=value.server.initialDelivery!;
    expect(contract).toMatchObject({browser:'bindings',key:value.client.initialDelivery?.key});
    expect(contract).not.toHaveProperty('html');
    const options={initialKey:contract.key,mode:'shell' as const};
    const response=await render(value.serverModule.App,{...options,fetch:(async()=>Response.json({name:''})) as FetchStub});
    expect(response.html).toBe('<main><section><h2><!--mmd:empty--></h2><p>Kept</p></section><button>0</button></main>');
    expect(response.payload.state?.sources).toHaveLength(1);
    expect(response.scriptTag).toContain('application/mmd+json');
    expect(response.settlement.status).toBe('complete');
    const stream=renderToReadableStream(value.serverModule.App,{...options,fetch:(async()=>Response.json({name:''})) as FetchStub});
    expect(await new Response(stream).text()).toBe(response.html+response.scriptTag);
    const full=await render(value.serverModule.App,{...options,markers:true,fetch:(async()=>Response.json({name:'Ada & <friends>'})) as FetchStub});
    expect(full.html).toContain('<h2>Ada &amp; &lt;friends&gt;</h2>');
    expect(full.html).not.toContain('mmd:r:');expect(full.scriptTag).toContain('application/mmd+json');
  });

  it('preserves identical empty text addresses in node and retained writers without changing other request documents',()=>{
    const initial=new StringDocument(),ordinary=new StringDocument();
    initial.useInitialBindings();
    const serialize=(node:Node, bindings:boolean)=>(node as unknown as StringRenderableNode).toString(false,bindings);
    for(const value of ['', 'Ada & <friends>']) {
      const expected=value===''?'<!--mmd:empty-->':'Ada &amp; &lt;friends&gt;';
      expect(serialize(initial.createTextNode(value),true)).toBe(expected);
      expect(serialize(initial.htmlWriter.create(()=>initial.htmlWriter.text(value)),true)).toBe(expected);
    }
    expect(serialize(ordinary.htmlWriter.create(()=>ordinary.htmlWriter.text('')),false)).toBe('');
    expect(serialize(ordinary.createTextNode(''),false)).toBe('');
  });
  it.each(['component', 'module'])('settles concurrent request-only compositions independently with %s-owned data', async placement => {
    const declaration = `const user=$fetch('/api/user');`;
    const value = await fixture(`request-only-${placement}`, `${placement === 'module' ? declaration : ''}
      function Card({name}){return <section><h2 title={name}>{'Hello '+name}</h2></section>;}
      export function App(){${placement === 'component' ? declaration : ''}return <main><h1>Directory</h1><Card name={user?.name}/></main>;}`);
    const contract = value.server.initialDelivery!;
    expect(contract.browser).toBe('none');
    expect(contract).not.toHaveProperty('html');
    expect(contract.key).toBe(value.client.initialDelivery?.key);
    const releases: Array<() => void> = [];
    let calls = 0;
    const fetchFor = (name: string): typeof fetch => (async () => {
      calls++;
      await new Promise<void>(resolve => releases.push(resolve));
      return Response.json({ name });
    }) as FetchStub;
    const options = { initialKey: contract.key, markers: true, mode: 'shell' as const };
    const first = render(value.serverModule.App, { ...options, fetch: fetchFor('Ada & <friends>') });
    const second = render(value.serverModule.App, { ...options, fetch: fetchFor('Grace') });
    await waitFor(async () => expect(await (() => releases.length)()).toBe(2));
    releases[1]!(); releases[0]!();
    const results = await Promise.all([first, second]);
    expect(results[0]!.html).toContain('Hello Ada &amp; &lt;friends&gt;');
    expect(results[0]!.html).not.toContain('Grace');
    expect(results[1]!.html).toContain('Hello Grace');
    expect(results[1]!.html).not.toContain('Ada');
    for (const result of results) {
      expect(result.settlement.status).toBe('complete');
      expect(result.html).not.toMatch(/<!--|<script/);
      expect(result.payload).toEqual({ version: 1 });
      expect(result.scriptTag).toBe('');
    }
    expect(calls).toBe(2);
    expect(() => renderToString(value.serverModule.App, options)).toThrow('requires asynchronous rendering');
    await expect(render(value.serverModule.App, { ...options, initialKey: 'stale', fetch: fetchFor('Wrong') }))
      .rejects.toThrow('contracts do not match');
    expect(calls).toBe(2);
    const jsonFetch = (async () => Response.json({ name: 'Stream' })) as FetchStub;
    const stream = renderToReadableStream(value.serverModule.App, { ...options, fetch: jsonFetch });
    expect(await new Response(stream).text()).toContain('<h2 title="Stream">Hello Stream</h2>');
    const ordinary = await render(value.serverModule.App, { mode: 'resolve', markers: true, fetch: jsonFetch });
    expect(ordinary.html).toContain('mmd:r:');
    expect(ordinary.scriptTag).toContain('application/mmd+json');
    expect(ordinary.payload.state?.sources.length).toBeGreaterThan(0);
  });

  it('rejects request-only timeouts and cancellation and releases pending fetches', async () => {
    const value = await fixture('request-timeout', `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`);
    const signals: AbortSignal[] = [];
    const hangingFetch = ((_input: unknown, init?: RequestInit) => {
      signals.push(init!.signal!); return new Promise<Response>(() => {});
    }) as FetchStub;
    const options = { initialKey: value.server.initialDelivery!.key, fetch: hangingFetch };
    await expect(render(value.serverModule.App, { ...options, timeout: 10 })).rejects.toThrow('did not settle');
    expect(signals[0]!.aborted).toBe(true);
    const controller = new AbortController();
    const pending = render(value.serverModule.App, { ...options, signal: controller.signal });
    const rejected = pending.then(() => { throw new Error('Expected promise rejection'); }, error => error);
    await waitFor(async () => expect(await (() => signals.length)()).toBe(2));
    controller.abort(new Error('Disconnected'));
    const rejectedError = await rejected;
    expect(() => { throw rejectedError; }).toThrow('Disconnected');
    expect(signals[1]!.aborted).toBe(true);
  });

  it.each([false, true])('contains scheduled fetch failures within their render and preserves concurrent success (contract=%s)', async contract => {
    const value = await fixture(`request-failure-${contract}`, `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`);
    const options = { mode: 'resolve' as const, ...(contract ? { initialKey: value.server.initialDelivery!.key } : {}) };
    const results = await Promise.allSettled([
      render(value.serverModule.App, { ...options, fetch: (async () => new Response('Unavailable', { status: 503 })) as FetchStub }),
      render(value.serverModule.App, { ...options, fetch: (async () => Response.json({ name: 'Still isolated' })) as FetchStub }),
    ]);
    expect(results[0]!.status).toBe('rejected');
    if (results[0]!.status === 'rejected') expect(results[0]!.reason.message).toContain('503');
    expect(results[1]!.status).toBe('fulfilled');
    if (results[1]!.status === 'fulfilled') expect(results[1]!.value.html).toBe('<h1>Still isolated</h1>');
  });

  it.each(['shell', 'resolve'] as const)('serves request-only HTML after settlement with a %s policy and reports failures before commit', async mode => {
    const value = await fixture(`request-handler-${mode}`, `export function App(){const user=$fetch('/api/user');return <main><h1>{user?.name}</h1></main>;}`);
    const contract = value.server.initialDelivery!;
    const application = serve();
    let fail = false;
    application.get('/api/user', () => fail
      ? new Response('Unavailable', { status: 503 }) : { name: 'Ada' });
    application.ssr(value.serverModule.App, { mode, delivery: 'stream', timeout: 20 });
    (application as unknown as { installDocumentTemplate(template: string): void }).installDocumentTemplate(
      `<html><head></head><body><div id="root"><!--ssr-outlet--></div></body></html>` +
      initialBootstrapDescriptor({ key: contract.key, target: 'root', browser: 'none' }));
    const response = await application.fetch(new Request('https://app.test/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<main><h1>Ada</h1></main>');
    expect(html).not.toMatch(/<script|mmd:r:|initial-delivery/);
    fail = true;
    const failed = await application.fetch(new Request('https://app.test/'));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('<main>');
  });

});

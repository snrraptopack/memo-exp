import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build, type Rollup } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { MountedApplication } from '@memoized-dom/runtime';
import memoizedDom from '../src';
import { routedApp, routedDetail, routedOpaque, initializeRoutedLifecycles, checkRoutedLifecycles } from './fixtures/routed-lifecycles';

let fixture: string | undefined;
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); fixture = undefined; });

async function production(name: string, source: string, extras: Record<string, string> = {}, userName: string | Record<string,unknown> = 'Ada', clientOnly = false) {
  fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-initial-ssr-'));
  await mkdir(join(fixture, 'src'));
  await writeFile(join(fixture, 'index.html'), '<!doctype html><html><head><title>SSR</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./src/main.ts"></script></body></html>');
  await writeFile(join(fixture, 'src/main.ts'), `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`);
  await writeFile(join(fixture, 'src/App.tsx'), source);
  for (const [file, content] of Object.entries(extras)) await writeFile(join(fixture, file), content);
  await writeFile(join(fixture, 'server.ts'), `import {serve} from '@memoized-dom/server';import {App} from './src/App';const app=serve();app.get('/api/user',()=>(${JSON.stringify(typeof userName==='string'?{name:userName}:userName)}));app.ssr(App);export default app;`);
  const repository = resolve(import.meta.dirname, '../../..');
  const config = (ssr = false) => ({ root: fixture!, configFile: false as const, logLevel: 'silent' as const,
    resolve: { alias: Object.entries({
      '@memoized-dom/runtime/hydrate': 'packages/runtime/dist/hydrate.js',
      '@memoized-dom/runtime/hydrate-program': 'packages/runtime/dist/hydrate-program.js',
      '@memoized-dom/runtime/server': 'packages/runtime/dist/server.js',
      '@memoized-dom/runtime': `packages/runtime/dist/${ssr ? 'server' : 'index'}.js`,
      '@memoized-dom/data/internal': 'packages/data/dist/internal.js',
      '@memoized-dom/data': 'packages/data/dist/index.js',
      '@memoized-dom/router/internal': 'packages/router/dist/internal.js',
      '@memoized-dom/router': 'packages/router/dist/index.js',
      '@memoized-dom/server/router': 'packages/server/dist/http-router.js',
      '@memoized-dom/server': 'packages/server/dist/index.js',
    }).map(([name, path]) => ({ find: new RegExp(`^${name}$`), replacement: resolve(repository, path) })) },
    base: '/demo/', plugins: [memoizedDom({ clientEntry: 'src/main.ts', ...(clientOnly ? {} : {serverEntry: 'server.ts'}) })] });
  const client = await build({ ...config(), build: { write: false } });
  const files = (Array.isArray(client) ? client : [client]).flatMap(value => value.output);
  const html = String(files.find(file => file.type === 'asset' && file.fileName === 'index.html')?.source);
  const server = await build({ ...config(true), build: { write: false, ssr: 'server.ts' } });
  const output = (Array.isArray(server) ? server : [server]).flatMap(value => value.output);
  const directory = join(import.meta.dirname, 'fixtures/out/initial-ssr', name);
  mkdirSync(directory, { recursive: true });
  for (const file of output) {
    const path = join(directory, file.fileName);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, file.type === 'chunk' ? file.code : file.source);
  }
  const entry = output.find((file): file is Rollup.OutputChunk => file.type === 'chunk' && file.isEntry)!;
  const { default: app } = await import(/* @vite-ignore */ pathToFileURL(join(directory, entry.fileName)).href);
  app.installDocumentTemplate(html);
  return { app, html, files };
}

function chromeExecutable(): string | undefined {
  return [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
    .find((path): path is string => !!path && existsSync(path));
}

async function browserPage(result: Awaited<ReturnType<typeof production>>, html: string, executablePath: string,
  check: (page: Page, apiRequests: string[]) => Promise<void>, pathname = '/demo/',
  apiData: () => unknown = () => ({name:'Unexpected client fetch'})): Promise<void> {
  const apiRequests: string[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url?.replace(/^\/demo\//, '');
    if (request.url?.startsWith('/api/')) apiRequests.push(request.url);
    const asset = result.files.find(file => file.fileName === path);
    if (request.url?.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(apiData()));
    } else if (asset) {
      response.setHeader('content-type', asset.type === 'chunk' ? 'text/javascript' : 'text/css');
      response.end(asset.type === 'chunk' ? asset.code : asset.source);
    } else {
      response.setHeader('content-type', 'text/html'); response.end(html);
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await initializeRoutedLifecycles(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.evaluateOnNewDocument(() => {
      const values = window as unknown as { initial?: Element[]; created: string[] };
      values.created = [];
      const create = document.createElement.bind(document);
      document.createElement = ((...args: Parameters<Document['createElement']>) => {
        values.created.push(args[0]); return create(...args);
      }) as Document['createElement'];
      new MutationObserver(() => {
        if (document.querySelector('main')) values.initial ??= [...document.querySelectorAll('#root *')];
      }).observe(document, { childList: true, subtree: true });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    await page.goto(`http://127.0.0.1:${address.port}${pathname}`);
    try { await check(page, apiRequests); }
    catch(error) {
      if(errors.length) throw new AggregateError([error,...errors.map(message=>new Error(message))],'Production browser check failed');
      throw error;
    }
    expect(errors).toEqual([]);
  } finally {
    try { await browser.close(); } finally { await new Promise<void>(done => server.close(() => done())); }
  }
}

describe('production initial SSR bootstrap', () => {
  it('omits restoration from client-only fetched Group delivery and retains reactive inputs in Chrome', async context => {
    const executablePath = chromeExecutable();if (!executablePath) {context.skip();return;}
    const result = await production('client-only-request', `import {Group} from '@memoized-dom/data';
      function Pending(){return <i>Waiting</i>;}export function App(){let name='Ada';let n=0;
      const user=$fetch('/api/user',{query:{name}});return <main><button class="next" onClick={()=>n++}>Next {n}</button>
        <button class="change" onClick={()=>name='Lin'}>Change</button><Group pending={Pending}><p>{user?.name}:{n}</p></Group></main>;}`, {}, 'Ada', true);
    const delivered = result.files.filter(file => file.type === 'chunk').map(file => file.code).join('\n');
    expect(delivered).not.toContain('Serialized data state sources must be an array');
    expect(delivered).not.toContain('Request body must be JSON-serializable');
    let name = 'Ada';
    await browserPage(result, result.html, executablePath, async (page, requests) => {
      await page.waitForFunction(() => document.querySelector('p')?.textContent === 'Ada:0');
      expect(requests).toEqual(['/api/user?name=Ada']);
      await page.click('.next');await page.waitForFunction(() => document.querySelector('p')?.textContent === 'Ada:1');
      name = 'Lin';await page.click('.change');
      await page.waitForFunction(() => document.querySelector('p')?.textContent === 'Lin:1');
      expect(requests).toEqual(['/api/user?name=Ada','/api/user?name=Lin']);
      expect(await page.evaluate(() => {
        const initial=(window as unknown as {initial:Element[]}).initial;
        return initial.includes(document.querySelector('main')!) && initial.includes(document.querySelector('.next')!);
      })).toBe(true);
    }, '/demo/', () => ({name}));
  },60_000);

  it.each([0,2])('binds fetched lists inside repeated authored children (%i rows) in Chrome',async(count,context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production(`structural-child-list-${count}`,`import {Shell} from './Shell';export function App(){
      const user=$fetch('/api/user');let n=0;return <main><button class="next" onClick={()=>n++}>Next</button><Shell>
        <ul>{user?.rows?.map((row,index)=><li key={row.id}>{index}:{row.label}:{n}</li>)}</ul><h3>After {n}</h3>
      </Shell></main>;}`,{
      'src/Shell.tsx':`import {Frame} from './Frame';export function Shell({children}){return <section><h2>Before</h2>{children}<Frame>{children}</Frame></section>;}`,
      'src/Frame.tsx':`export function Frame({children}){return <aside><i>Prefix</i><em>Second prefix</em>{children}<footer>After</footer></aside>;}`,
    },{rows:Array.from({length:count},(_,id)=>({id,label:'row'+id}))});
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();expect(html).not.toContain('mmd:r:');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      await page.waitForFunction(()=>document.querySelectorAll('h3').length===2);
      await page.click('.next');await page.waitForFunction(()=>[...document.querySelectorAll('h3')].every(node=>node.textContent==='After 1'));
      expect(await page.$$eval('ul',nodes=>nodes.map(node=>[...node.children].map(row=>row.textContent))))
        .toEqual([0,1].map(()=>Array.from({length:count},(_,id)=>`${id}:row${id}:1`)));
      expect(await page.evaluate(()=>{
        const state=window as unknown as {initial:Element[];created:string[]};
        const initial=state.initial.filter(node=>node.localName!=='script'),current=[...document.querySelectorAll('#root *:not(script)')];
        return {retained:initial.length===current.length&&initial.every((node,index)=>node===current[index]),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({retained:true,created:[]});expect(requests).toEqual([]);
    });
  },60_000);

  it.each(['Ada',''])('binds request-selected conditional children and recreates branches in Chrome (name=%s)',async(name,context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production(`structural-child-conditional-${name||'empty'}`,`import {Shell} from './Shell';export function App(){
      const user=$fetch('/api/user');let open=true;let n=0;return <main><button class="toggle" onClick={()=>open=!open}>Toggle</button>
        <button class="next" onClick={()=>n++}>Next</button><Shell>
          {user?.name==='Ada'&&open?<p class="present">Ada:{n}</p>:<i class="empty">Hidden:{n}</i>}
        </Shell></main>;}`,{
      'src/Shell.tsx':`export function Shell({children}){return <section><h2>Before</h2>{children}<aside><b>Prefix</b><b>Second prefix</b>{children}</aside></section>;}`,
    },name);
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();expect(html).not.toContain('mmd:r:');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      const selector=name?'.present':'.empty';await page.waitForSelector(selector);
      await page.evaluate(selector=>{(window as unknown as {kept:Element[]}).kept=[...document.querySelectorAll(selector)];},selector);
      await page.click('.next');await page.waitForFunction((selector,text)=>[...document.querySelectorAll(selector)].every(node=>node.textContent===text),{},selector,(name?'Ada:':'Hidden:')+'1');
      expect(await page.$$eval(selector,nodes=>nodes.map(node=>node.textContent))).toEqual([0,1].map(()=>(name?'Ada:':'Hidden:')+'1'));
      expect(await page.evaluate(()=>(window as unknown as {kept:Element[]}).kept.every(node=>node.isConnected))).toBe(true);
      if(name){
        await page.click('.toggle');await page.waitForFunction(()=>document.querySelectorAll('.empty').length===2);
        await page.click('.next');await page.waitForFunction(()=>[...document.querySelectorAll('.empty')].every(node=>node.textContent==='Hidden:2'));
        await page.click('.toggle');await page.waitForFunction(()=>document.querySelectorAll('.present').length===2);
        expect(await page.$$eval('.present',nodes=>nodes.map(node=>node.textContent))).toEqual(['Ada:2','Ada:2']);
        expect(await page.evaluate(()=>(window as unknown as {kept:Element[]}).kept.every(node=>!node.isConnected))).toBe(true);
      }
      expect(requests).toEqual([]);
    });
  },60_000);
  it.each([0,2])('binds repeated live slots before and after %i fetched rows in Chrome',async(count,context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production(`live-slot-list-suffix-${count}`,`import {Shell} from './Shell';
      export function App(){let n=0;return <main><Shell><button onClick={()=>n++}>{n}</button></Shell></main>;}`,{
      'src/Shell.tsx':`export function Shell({children}){const user=$fetch('/api/user');
        return <section><h2>Before</h2>{children}{user?.rows?.map(row=><li key={row.id}>{row.label}</li>)}{children}<footer>After</footer></section>;}`,
    },{rows:Array.from({length:count},(_,id)=>({id,label:'Row '+id}))});
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).not.toContain('mmd:r:');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      await page.waitForFunction(()=>document.querySelectorAll('button').length===2);
      await page.click('button');await page.waitForFunction(()=>[...document.querySelectorAll('button')].every(node=>node.textContent==='1'));
      await page.evaluate(()=>document.querySelectorAll('button')[1]!.click());
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].every(node=>node.textContent==='2'));
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(Array.from({length:count},(_,id)=>'Row '+id));
      expect(await page.$('script[type="application/mmd+json"]')).toBeNull();
      expect(await page.evaluate(()=>{
        const state=window as unknown as {initial:Element[];created:string[]};
        // The request payload script is consumed by bootstrap; authored DOM is retained.
        const initial=state.initial.filter(node=>node.localName!=='script');
        const current=[...document.querySelectorAll('#root *:not(script)')];
        return {retained:initial.length===current.length&&initial.every((node,index)=>node===current[index]),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({retained:true,created:[]});
      expect(requests).toEqual([]);
    });
  },60_000);
  it('binds live forwarded children, caller callbacks and refs without recreating nodes in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('live-forwarded-children',`import {Shell} from './Shell';
      export function App(){let n=0;let input:HTMLInputElement|null=null;
        function next(){n++;}
        $effect(()=>{if(input)input.title='count:'+n;});
        return <main><button id="outer" onClick={next}>Next</button>
          <Shell><button class="inner" onClick={next}>{n}</button><input ref={input} value={n}/></Shell></main>;}`,{
      'src/Shell.tsx':`import {Frame} from './Frame';export function Shell({children}){return <section><h2>Prefix</h2><Frame>{children}</Frame><footer>Kept</footer></section>;}`,
      'src/Frame.tsx':`export function Frame({children}){return <aside>{children}</aside>;}`,
    });
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).not.toContain('mmd:r:');expect(html).not.toContain('application/mmd+json');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      await page.waitForFunction(()=>document.querySelector('input')?.title==='count:0');
      await page.click('#outer');await page.waitForFunction(()=>document.querySelector('.inner')?.textContent==='1');
      await page.click('.inner');await page.waitForFunction(()=>document.querySelector('.inner')?.textContent==='2');
      expect(await page.$eval('input',node=>({title:node.title,value:node.value}))).toEqual({title:'count:2',value:'2'});
      expect(await page.evaluate(()=>{
        const state=window as unknown as {initial:Element[];created:string[]};
        const current=[...document.querySelectorAll('#root *')];
        return {retained:current.every((node,index)=>state.initial[index]===node),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({retained:true,created:[]});
      expect(requests).toEqual([]);
    });
  },60_000);
  it('captures a mount handle with real DOM nodes and permits remount after unmount in Chrome', async context => {
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('captured-mount',`export function App(){return <><header>Header</header><main>Ready</main><footer>Footer</footer></>;}`,{
      'src/main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';
        const rendered=mount('root',App);
        Object.assign(window,{rendered,remount:()=>mount('root',App)});`,
    });
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    await browserPage(result,html,executablePath,async page=>{
      await page.waitForFunction(()=>!!(window as unknown as {rendered?: MountedApplication}).rendered);
      const checks=await page.evaluate(()=>{
        const {rendered,remount}=window as unknown as {rendered:MountedApplication;remount:()=>MountedApplication};
        const json=JSON.parse(JSON.stringify(rendered));
        const nodes=rendered.nodes.every((node:Node)=>node instanceof Node&&node.isConnected);
        const owned=rendered.nodes.every((node:Node,index:number)=>rendered.host.children[index]===node);
        let duplicate='';try{remount();}catch(error){duplicate=String(error);}
        rendered.unmount();const empty=rendered.host.childNodes.length===0;
        const disconnected=rendered.nodes.every((node:Node)=>!node.isConnected);
        const next=remount();const fresh=next.nodes[0]!==rendered.nodes[0];
        const text=next.host.textContent;next.unmount();
        return {json,nodes,owned,duplicate,empty,disconnected,fresh,text};
      });
      expect(checks.json).toEqual({host:{},rootId:'App',nodes:[{},{},{}],mounted:true});
      for(const field of ['nodes','owned','empty','disconnected','fresh'] as const) expect(checks[field],field).toBe(true);
      expect(checks.duplicate).toContain('already owns an application');
      expect(checks.text).toBe('HeaderReadyFooter');
    });
  },60_000);
  it('preserves written let state while unwritten prop derivations refresh after SSR', async context => {
    const executablePath = chromeExecutable(); if (!executablePath) { context.skip(); return; }
    const result = await production('writable-prop-initializer', `
      function Counter({seed}) {
        let owned = seed * 2;
        let live = seed * 3;
        const label = owned + ':' + live;
        return <button id="own" onClick={() => owned++}>{label}</button>;
      }
      export function App() { let seed = 2;
        return <main><button id="source" onClick={() => seed++}>source</button><Counter seed={seed}/></main>;
      }`);
    const html = await (await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain('4:6');
    await browserPage(result, html, executablePath, async (page, requests) => {
      await page.waitForSelector('#own');
      await page.evaluate(() => { (window as unknown as {owned: Element}).owned = document.querySelector('#own')!; });
      await page.click('#own');
      await page.waitForFunction(() => document.querySelector('#own')?.textContent === '5:6');
      await page.click('#source');
      await page.waitForFunction(() => document.querySelector('#own')?.textContent === '5:9');
      await page.click('#own');
      await page.waitForFunction(() => document.querySelector('#own')?.textContent === '6:9');
      expect(await page.evaluate(() => (window as unknown as {owned: Element}).owned === document.querySelector('#own'))).toBe(true);
      expect(requests).toEqual([]);
    });
  }, 60_000);
  it('retains static child slots as HTML while binding the counter in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('static-child-slots',`import {Shell} from './Shell';export function App(){let n=0;
      return <main><button onClick={()=>n++}>{n}</button><Shell><h2>One</h2></Shell>
        <Shell><p>Two</p><b>Extra</b></Shell></main>;}`,{
      'src/Shell.tsx': `import {Frame} from './Frame';export function Shell({children}){return <section><Frame>{children}</Frame></section>;}`,
      'src/Frame.tsx': `export function Frame({children}){return <aside>{children}</aside>;}`,
    });
    expect(result.html).toContain('mmd:initial-delivery:');
    const code=result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n');
    expect(code).not.toContain('One');expect(code).not.toContain('Extra');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    await browserPage(result,html,executablePath,async(page,requests)=>{
      await page.waitForSelector('button');await page.click('button');
      await page.waitForFunction(()=>document.querySelector('button')?.textContent==='1');
      expect(await page.$$eval('aside',nodes=>nodes.map(node=>node.textContent))).toEqual(['One','TwoExtra']);
      expect(await page.evaluate(()=>{
        const values=window as unknown as {initial:Element[];created:string[]};
        return values.initial.length===[...document.querySelectorAll('#root *')].length &&
          values.initial.every((node,index)=>node===document.querySelectorAll('#root *')[index]) &&
          values.created.filter(tag=>tag!=='link').length===0;
      })).toBe(true);
      expect(requests).toEqual([]);
    });
  },60_000);
  it.each([0,2])('retains fixed siblings around %i fetched rows in Chrome',async(count,context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const initial=[{id:1,label:'one'},{id:2,label:'two'}].slice(0,count);
    const result=await production(`request-siblings-${count}`,`export function App(){const user=$fetch('/api/user');
      const request=$track(user);let n=0;let show=true;let fixed=['fixed'];
      return <main><h1>{user?.name}</h1>{user?.rows?.map((item,index)=><li key={item.id}>{index}:{item.label}</li>)}
        <button class="add" onClick={()=>n++}>{n}</button>{n}
        <button class="reload" onClick={()=>request.refresh()}>Reload</button>
        <button class="toggle" onClick={()=>show=!show}>Toggle</button>{show&&<p>Shown</p>}
        {fixed.map(item=><aside>{item}</aside>)}<footer>After</footer></main>;}`,{}, {name:'Ada',rows:initial});
    expect(result.html).toContain('mmd:initial-delivery:');
    const response=await result.app.fetch(new Request('https://app.test/demo/'));
    expect(response.status).toBe(200);const html=await response.text();expect(html).not.toContain('mmd:w:');
    let next=[...initial].reverse();
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(requests).toEqual([]);
      expect(await page.evaluate(()=>{
        const state=window as unknown as {created:string[];initial:Element[];rows:Element[];footer:Element};
        state.rows=[...document.querySelectorAll('li')];state.footer=document.querySelector('footer')!;
        return {created:state.created.filter(tag=>tag!=='link'),retained:state.initial.filter(node=>node.localName!=='script').every(node=>node.isConnected)};
      })).toEqual({created:[],retained:true});
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('.add')?.textContent==='1');
      expect(await page.$eval('main',node=>[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''))).toBe('1');
      await page.click('.reload');await page.waitForFunction(expected=>[...document.querySelectorAll('li')].map(n=>n.textContent).join('|')===expected,
        {},next.map((row,index)=>`${index}:${row.label}`).join('|'));
      expect(await page.evaluate(()=>{
        const state=window as unknown as {rows:Element[]};return [...document.querySelectorAll('li')].every((node,index)=>node===state.rows[state.rows.length-index-1]);
      })).toBe(true);
      next=[];await page.click('.reload');await page.waitForFunction(()=>document.querySelectorAll('li').length===0);
      next=[{id:3,label:'three'}];await page.click('.reload');await page.waitForFunction(()=>document.querySelector('li')?.textContent==='0:three');
      await page.click('.toggle');await page.waitForFunction(()=>!document.querySelector('p'));
      await page.click('.toggle');await page.waitForSelector('p');
      expect(await page.$eval('aside',node=>node.textContent)).toBe('fixed');
      expect(await page.evaluate(()=>(window as unknown as {footer:Element}).footer===document.querySelector('footer'))).toBe(true);
    },'/demo/',()=>({name:'Ada',rows:next}));
  },60_000);
  it('binds a composed lifetime owner and reruns its effect in Chrome',async context=>{
    const result=await production('lifetime-owner',`function Panel(){let n=0;let node=null;
      $effect(()=>{if(node)node.title='count:'+n;});
      $cleanup(()=>{document.body.dataset.cleaned='yes';});
      return <section><input ref={node}/><button onClick={()=>n++}>{n}</button></section>;}
      export function App(){return <main><h1>Kept</h1><Panel/></main>;}`);
    expect(result.html).toContain('mmd:initial-delivery:');
    const response=await result.app.fetch(new Request('https://app.test/demo/'));
    expect(response.status).toBe(200);const html=await response.text();
    expect(html).not.toContain('mmd:r:');
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    await browserPage(result,html,executablePath,async page=>{
      expect(await page.$eval('input',node=>node.title)).toBe('count:0');
      await page.click('button');
      expect(await page.$eval('input',node=>node.title)).toBe('count:1');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {initial:Element[];created:string[]};
        return {retained:state.initial.every(node=>node.isConnected),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({retained:true,created:[]});
    });
  },60_000);
  it.each([
    {userName:'Ada',placement:'component'},{userName:'',placement:'component'},
    {userName:'Ada',placement:'module'},{userName:'',placement:'module'},
  ])('binds settled fetched composition without creating nodes or fetching again in Chrome (%j)',async({userName,placement},context)=>{
    const declaration=`const user=$fetch('/api/user');`;
    const result=await production(`request-bound-${placement}-${userName||'empty'}`,`import {Card} from './Card';
      ${placement==='module'?declaration:''}
      export function App(){${placement==='component'?declaration:''}let count=0;return <main><Card name={user?.name}/>
        <button onClick={()=>count++}>{count}</button></main>;}`,{
      'src/Card.tsx':`export function Card({name}){return <section><h2>{name}</h2><p>Kept</p></section>;}`,
    },userName);
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain(userName?'<h2>Ada</h2>':'<h2><!--mmd:empty--></h2>');
    expect(html).toContain('application/mmd+json');expect(html).not.toContain('mmd:r:');
    const scripts=result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n');
    expect(scripts).not.toContain('hydration runtime is not installed');
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(await page.$eval('h2',node=>node.textContent)).toBe(userName);
      expect(await page.$eval('p',node=>node.textContent)).toBe('Kept');
      expect(await page.$('script[type="application/mmd+json"]')).toBeNull();
      await page.click('button');await page.waitForFunction(()=>document.querySelector('button')?.textContent==='1');
      expect(await page.$eval('h2',node=>node.textContent)).toBe(userName);
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return ['main','section','h2','p','button'].every(selector=>initial.includes(document.querySelector(selector)!));
      })).toBe(true);
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      expect(requests).toEqual([]);
    });
  },60_000);

  it('serves fetched composition with zero JavaScript, preserved CSS and no browser fetch in Chrome', async context => {
    const result = await production('request-only', `import './theme.css';import {Card} from './Card';
      export function App(){const user=$fetch('/api/user');return <main><h1>Directory</h1><Card name={user?.name}/></main>;}`, {
      'src/theme.css': 'h2{color:rgb(1,2,3)}',
      'src/Card.tsx': `export function Card({name}){return <section><h2 title={name}>{'Hello '+name}</h2></section>;}`,
    });
    expect(result.html).toContain('mmd:initial-delivery:');
    expect(result.files.filter(file => file.type === 'chunk')).toHaveLength(0);
    const responses = await Promise.all([0, 1].map(() => result.app.fetch(new Request('https://app.test/demo/'))));
    for (const response of responses) expect(response.status).toBe(200);
    const documents = await Promise.all(responses.map(response => response.text()));
    expect(documents[0]).toBe(documents[1]);
    const html = documents[0]!;
    expect(html).toContain('<section><h2 title="Ada">Hello Ada</h2></section>');
    expect(html).toMatch(/rel="stylesheet"[^>]+href="\/demo\/assets\//);
    expect(html).not.toMatch(/<script|modulepreload|application\/mmd\+json|<!--|initial-delivery/);
    const executablePath = chromeExecutable();
    if (!executablePath) { context.skip(); return; }
    await browserPage(result, html, executablePath, async (page, apiRequests) => {
      expect(await page.$eval('h2', node => [node.textContent, getComputedStyle(node).color]))
        .toEqual(['Hello Ada', 'rgb(1, 2, 3)']);
      expect(await page.evaluate(() => (window as unknown as { created: string[] }).created)).toEqual([]);
      expect(apiRequests).toEqual([]);
    });
  }, 60_000);

  it('preserves lazy route lifecycles with compiler-selected production hydration in Chrome', async context => {
    const executablePath = chromeExecutable();
    if (!executablePath) { context.skip(); return; }
    const result = await production('routed-lifecycles', routedApp, {
      'src/Detail.tsx': routedDetail, 'src/opaque.mjs': routedOpaque,
    });
    expect(result.html).not.toContain('mmd:initial-delivery:');
    expect(result.files.filter(file => file.type === 'chunk' && !file.isEntry).length).toBeGreaterThan(0);
    for (const pathname of ['/demo/', '/demo/detail']) {
      const html = await (await result.app.fetch(new Request(`https://app.test${pathname}`))).text();
      expect(html).toContain('application/mmd+json');
      await browserPage(result, html, executablePath, async (page, requests) => {
        if (pathname === '/demo/') {
          expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
          await page.click('.detail');
        }
        await checkRoutedLifecycles(page);
        expect(requests).toEqual([]);
      }, pathname);
    }
  }, 60_000);

  it('serves a static composition with zero JavaScript and no hydration payload', async () => {
    const result = await production('static', `import './theme.css';function Card({name}){return <section><h2>{name}</h2></section>;}
      export function App(){let name='Ada';const greeting='Hello '+name;return <main><Card name={greeting}/></main>;}`,
      { 'src/theme.css': 'h2{color:rgb(1,2,3)}' });
    expect(result.html).toContain('mmd:initial-delivery:');
    expect(result.files.filter(file => file.type === 'chunk')).toHaveLength(0);
    const response = await result.app.fetch(new Request('https://app.test/demo/'));
    const html = await response.text();
    expect(html).toContain('<main><section><h2>Hello Ada</h2></section></main>');
    expect(html).toMatch(/rel="stylesheet"[^>]+href="\/demo\/assets\//);
    expect(result.files.some(file => file.type === 'asset' && file.fileName.endsWith('.css'))).toBe(true);
    expect(html).not.toMatch(/<script|modulepreload|application\/mmd\+json|mmd:r:|mmd:bootstrap|initial-delivery/);
  }, 60_000);

  it('loads the binding entry, retains initial nodes and handles later creation in Chrome', async context => {
    const executablePath = chromeExecutable();
    if (!executablePath) { context.skip(); return; }
    const result = await production('interactive', `export function App(){let n=0;let items=[];let open=true;return <main>
      <h1>Static shell</h1><button class="add" onClick={()=>{n++;items=[...items,n];}}>Add</button><p>{n}</p>
      <button class="toggle" onClick={()=>open=!open}>Toggle</button>{open?<section><b>{n}</b></section>:<i>Closed</i>}
      <ul>{items.map((item,index)=><li key={index}>{index}:{item}</li>)}</ul></main>;}`);
    const html = await (await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toMatch(/src="\/demo\/assets\/index-[^"]+\.js"/);
    expect(html).not.toMatch(/application\/mmd\+json|mmd:r:/);
    expect(result.files.filter(file => file.type === 'chunk' && file.isEntry)).toHaveLength(1);
    expect(result.files.filter(file => file.type === 'chunk').map(file => file.code).join('\n')).not.toContain('Static shell');
    await browserPage(result, html, executablePath, async page => {
      // Vite's modulepreload capability probe creates one detached link.
      expect(await page.evaluate(() => (window as unknown as { created: string[] }).created.filter(tag => tag !== 'link'))).toEqual([]);
      await page.click('.add'); await page.waitForFunction(() => document.querySelector('li')?.textContent === '0:1');
      expect(await page.$eval('p', node => node.textContent)).toBe('1');
      await page.click('.toggle'); await page.waitForSelector('i');
      await page.click('.toggle'); await page.waitForSelector('b');
      expect(await page.$eval('b', node => node.textContent)).toBe('1');
      expect(await page.evaluate(() => {
        const initial = (window as unknown as { initial: Element[] }).initial;
        return ['main', 'h1', '.add', 'p', 'ul'].every(selector => initial.includes(document.querySelector(selector)!));
      })).toBe(true);
    });
  }, 60_000);

  it('binds composed SSR nodes and creates later child instances through the same factory in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const cards=Array.from({length:24},(_,index)=>`<article data-card="${index}"><h2>Card ${index}</h2><p>Ready.</p></article>`).join('');
    const result=await production('future-composition',`import {Card} from './Card';export function App(){let open=true;let n=1;
      return <main><h1>Static surroundings</h1><button class="toggle" onClick={()=>open=!open}>Toggle</button>
        <button class="increment" onClick={()=>n++}>Increment</button><Card value={n}/>{open&&<Card value={n+10}/>}</main>;}`,{
      'src/Card.tsx':`import {Label} from './Label';export function Card({value}){let clicks=0;return <section>
        <Label value={value}/><button class="child" onClick={()=>clicks++}>{clicks}</button>${cards}</section>;}`,
      'src/Label.tsx':`export function Label({value}){return <strong title={value}>{value}</strong>;}`,
    });
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).not.toMatch(/application\/mmd\+json|mmd:r:/);
    expect(result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n')).not.toContain('Static surroundings');
    await browserPage(result,html,executablePath,async page=>{
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      expect(await page.$$eval('article',nodes=>nodes.length)).toBe(48);
      await page.click('.increment');await page.waitForFunction(()=>document.querySelectorAll('strong')[1]?.textContent==='12');
      await page.click('section:nth-of-type(2) .child');
      await page.waitForFunction(()=>document.querySelectorAll('section .child')[1]?.textContent==='1');
      await page.click('.toggle');await page.waitForFunction(()=>document.querySelectorAll('section').length===1);
      await page.click('.toggle');await page.waitForFunction(()=>document.querySelectorAll('section').length===2);
      expect(await page.$$eval('section:nth-of-type(2) article',nodes=>nodes.map(node=>node.textContent)))
        .toEqual(Array.from({length:24},(_,index)=>`Card ${index}Ready.`));
      expect(await page.$$eval('strong',nodes=>nodes.map(node=>[node.textContent,node.getAttribute('title')]))).toEqual([['2','2'],['12','12']]);
      expect(await page.$$eval('section .child',nodes=>nodes.map(node=>node.textContent))).toEqual(['0','0']);
      await page.click('.increment');await page.waitForFunction(()=>document.querySelectorAll('strong')[1]?.textContent==='13');
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return ['main','h1','.toggle','.increment','section','strong',...Array.from({length:24},(_,index)=>`section:first-of-type article[data-card="${index}"]`)]
          .every(selector=>initial.includes(document.querySelector(selector)!));
      })).toBe(true);
    });
  },60_000);

  it('restores fixed request data and retains server nodes through initial bindings in Chrome', async context => {
    const cards = Array.from({length:16}, (_, index) =>
      `<article data-card="${index}"><h2>Card ${index}</h2><p>Ready &amp; waiting.</p></article>`).join('');
    const result = await production('request-data', `export function App(){const user=$fetch('/api/user');let count=0;return <main>
      <h1>{user?.name}</h1><button onClick={()=>count++}>{count}</button><section>${cards}</section></main>;}`);
    expect(result.html).toContain('mmd:initial-delivery:');
    expect(result.files.filter(file => file.type === 'chunk' && file.isEntry)).toHaveLength(1);
    const html = await (await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html.replace(/<!--[^]*?-->/g, '')).toContain('<h1>Ada</h1>');
    expect(html).not.toContain('mmd:r:App');
    expect(html).toContain('application/mmd+json');
    expect(result.files.filter(file => file.type === 'chunk').map(file => file.code).join('\n'))
      .not.toContain('Ready &amp; waiting.');
    const executablePath = chromeExecutable();
    if (!executablePath) { context.skip(); return; }
    await browserPage(result, html, executablePath, async (page, apiRequests) => {
      expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
      expect(await page.$$eval('article', nodes => nodes.map(node => node.textContent)))
        .toEqual(Array.from({length:16}, (_, index) => `Card ${index}Ready & waiting.`));
      expect(await page.$('script[type="application/mmd+json"]')).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { created: string[] }).created.filter(tag => tag !== 'link'))).toEqual([]);
      await page.click('button');
      await page.waitForFunction(() => document.querySelector('button')?.textContent === '1');
      expect(await page.evaluate(() => {
        const initial = (window as unknown as { initial: Element[] }).initial;
        return ['main', 'h1', 'button', 'section', ...Array.from({length:16}, (_, index) =>
          `article[data-card="${index}"]`)].every(selector => initial.includes(document.querySelector(selector)!));
      })).toBe(true);
      expect(apiRequests).toEqual([]);
    });
  }, 60_000);

  it.each(['Ada',''])('binds request-selected branches and creates later branches in Chrome (name=%s)',async(name,context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production(`request-condition-${name?'active':'empty'}`,`export function App(){const user=$fetch('/api/user');let show=true;let n=0;
      return <main><h1>{user?.name}</h1><button class="toggle" onClick={()=>show=!show}>Toggle</button>
        <button class="add" onClick={()=>n++}>{n}</button>
        {user?.name==='Ada' && show?<section title="ready"><h2>{user?.name}:{n}</h2></section>:<p>Hidden {n}</p>}
        <footer>Kept</footer><span>{n}</span></main>;}`,{},name);
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain('mmd:initial:when:');expect(html).not.toMatch(/mmd:[rgl]:/);
    expect(html).toContain('application/mmd+json');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      const selector=name?'section':'p';
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      expect(await page.evaluate(selector=>(window as unknown as {initial:Element[]}).initial.includes(document.querySelector(selector)!),selector)).toBe(true);
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('span')?.textContent==='1');
      expect(await page.$eval(selector,node=>node.textContent)).toBe(name?'Ada:1':'Hidden 1');
      expect(await page.evaluate(selector=>(window as unknown as {initial:Element[]}).initial.includes(document.querySelector(selector)!),selector)).toBe(true);
      await page.click('.toggle');
      if(name) {
        await page.waitForSelector('p');expect(await page.$eval('p',node=>node.textContent)).toBe('Hidden 1');
        await page.click('.toggle');await page.waitForSelector('section');
        expect(await page.$eval('section',node=>[node.textContent,node.getAttribute('title')])).toEqual(['Ada:1','ready']);
        expect(await page.evaluate(()=>(window as unknown as {initial:Element[]}).initial.includes(document.querySelector('section')!))).toBe(false);
      }
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('span')?.textContent==='2');
      expect(await page.$eval(selector,node=>node.textContent)).toBe(name?'Ada:2':'Hidden 2');
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return ['main','h1','footer','span','.toggle','.add'].every(selector=>initial.includes(document.querySelector(selector)!));
      })).toBe(true);
      expect(await page.$('script[type="application/mmd+json"]')).toBeNull();expect(requests).toEqual([]);
    });
  },60_000);

  it('merges live bindings across repeated request-selected component branches in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('request-condition-repeated',`function Card({active,label}){
      return <section>{active?<p title={label}>{label}</p>:<b>Hidden</b>}</section>;}
      export function App(){const user=$fetch('/api/user');let n=0;return <main><button onClick={()=>n++}>Add</button>
        <Card active={user?.name==='Ada'} label=""/><Card active={user?.name==='Ada'} label={n}/></main>;}`);
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(await page.$$eval('p',nodes=>nodes.map(node=>[node.textContent,node.getAttribute('title')]))).toEqual([['',''],['0','0']]);
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      await page.click('button');await page.waitForFunction(()=>document.querySelectorAll('p')[1]?.textContent==='1');
      expect(await page.$$eval('p',nodes=>nodes.map(node=>[node.textContent,node.getAttribute('title')]))).toEqual([['',''],['1','1']]);
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return [...document.querySelectorAll('section,p')].every(node=>initial.includes(node));
      })).toBe(true);expect(requests).toEqual([]);
    });
  },60_000);

  it('binds an initially empty local conditional beside settled request text in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('request-local-condition-empty',`export function App(){const user=$fetch('/api/user');let show=false;let n=0;
      return <main><h1>{user?.name}</h1><button class="toggle" onClick={()=>show=!show}>Toggle</button>
        {show&&<p>{user?.name}:{n}</p>}{n}<button class="add" onClick={()=>n++}>Add</button></main>;}`);
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(await page.$('p')).toBeNull();
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      await page.click('.toggle');await page.waitForSelector('p');expect(await page.$eval('p',node=>node.textContent)).toBe('Ada:0');
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('p')?.textContent==='Ada:1');
      expect(await page.$eval('main',node=>node.textContent)).toBe('AdaToggleAda:11Add');
      await page.click('.toggle');await page.waitForFunction(()=>document.querySelector('p')===null);
      expect(await page.$eval('main',node=>node.textContent)).toBe('AdaToggle1Add');
      expect(requests).toEqual([]);
    });
  },60_000);

  it.each([{count:0,positional:false,placement:'component'},{count:2,positional:false,placement:'component'},
    {count:2,positional:true,placement:'component'},{count:2,positional:false,placement:'module'}])('binds fetched rows and shares later reconciliation in Chrome (%j)',async({count,positional,placement},context)=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const initialRows=[{id:1,label:'one'},{id:2,label:'two'}].slice(0,count);
    const declaration=`const user=$fetch('/api/user');`;
    const result=await production(`fetched-rows-${placement}-${count}-${positional}`,`${placement==='module'?declaration:''}export function App(){${placement==='component'?declaration:''}const request=$track(user);let suffix='!';let selected='';
      return <main><h1>{user?.name}</h1><button class="suffix" onClick={()=>suffix+='!'}>Suffix</button>
        <button class="reload" onClick={()=>request.refresh()}>Reload</button>
        <ul>{user?.rows?.map((item,index)=><li key={${positional?'index':'item.id'}} title={item.label}>
          <button class="select" onClick={()=>selected=item.label}>{index}:{item.label}{suffix}</button></li>)}</ul>
        <p>{selected}</p><footer>Kept</footer></main>;}`,{},{name:'Ada',rows:initialRows});
    expect(result.html).toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain('mmd:initial:list:');expect(html).not.toContain('mmd:w:');
    let next=initialRows;
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(initialRows.map((row,index)=>`${index}:${row.label}!`));
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      expect(requests).toEqual([]);
      await page.click('.suffix');
      if(count) {
        await page.waitForFunction(()=>document.querySelector('li')?.textContent==='0:one!!');
        await page.click('.select');await page.waitForFunction(()=>document.querySelector('p')?.textContent==='one');
      }
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return [...document.querySelectorAll('li')].every(node=>initial.includes(node));
      })).toBe(true);
      for(const rows of [[{id:2,label:'two'},{id:1,label:'changed'},{id:3,label:'three'}],[],[{id:4,label:'new'}]]) {
        next=rows;await page.click('.reload');
        await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('li')].map(node=>node.textContent))===JSON.stringify(expected),{},rows.map((row,index)=>`${index}:${row.label}!!`));
        expect(await page.$$eval('li',nodes=>nodes.map(node=>node.getAttribute('title')))).toEqual(rows.map(row=>row.label));
      }
      await page.click('.select');await page.waitForFunction(()=>document.querySelector('p')?.textContent==='new');
      expect(await page.evaluate(()=>{
        const initial=(window as unknown as {initial:Element[]}).initial;
        return ['main','h1','ul','footer','.suffix','.reload'].every(selector=>initial.includes(document.querySelector(selector)!));
      })).toBe(true);expect(requests).toEqual(['/api/user','/api/user','/api/user']);
    },'/demo/',()=>({name:'Ada',rows:next}));
  },60_000);

  it('keeps untransferred query lists on general adoption without duplicate rows in Chrome',async context=>{
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const data={name:'Ada',rows:[{id:1,label:'one'},{id:2,label:'two'}]};
    const result=await production('fetched-query-adoption',`export function App(){const user=$fetch('/api/user',{query:{id:7}});let suffix='!';
      return <main><h1>{user?.name}</h1><button onClick={()=>suffix+='!'}>Change</button>
        <ul>{user?.rows?.map(item=><li key={item.id}>{item.label}{suffix}</li>)}</ul></main>;}`,{},data);
    expect(result.html).not.toContain('mmd:initial-delivery:');
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain('mmd:w:');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Ada'&&document.querySelectorAll('li').length===2);
      await page.click('button');await page.waitForFunction(()=>document.querySelector('li')?.textContent==='one!!');
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(['one!!','two!!']);
      expect(requests).toEqual(['/api/user?id=7']);
    },'/demo/',()=>data);
  },60_000);

  it('selects general keyed-list adoption and recovers unproved rows in Chrome', async context => {
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('request-list',`export function App(){const user=$fetch('/api/user');
      let rows=[{id:1,label:'one'},{id:2,label:'two'}];let show=false;return <main><h1>{user?.name}</h1>
        <button class="reverse" onClick={()=>rows=rows.toReversed()}>Reverse</button>
        <button class="append" onClick={()=>rows=[...rows,{id:3,label:'three'}]}>Append</button>
        <ul>{rows.map(row=><li key={row.id}>{row.label}{show&&<b>Extra</b>}</li>)}</ul></main>;}`);
    const html=await(await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html).toContain('mmd:w:');expect(html).not.toContain('mmd:initial-delivery:');
    await browserPage(result,html,executablePath,async(page,requests)=>{
      expect(await page.evaluate(()=>(window as unknown as {created:string[]}).created.filter(tag=>tag!=='link'))).toEqual([]);
      await page.click('.reverse');await page.waitForFunction(()=>document.querySelector('li')?.textContent==='two');
      await page.click('.append');await page.waitForFunction(()=>document.querySelectorAll('li').length===3);
      expect(await page.evaluate(()=>{
        const original=(window as unknown as {initial:Element[]}).initial.filter(node=>node.localName==='li');
        const rows=[...document.querySelectorAll('li')];return rows[0]===original[1]&&rows[1]===original[0];
      })).toBe(true);
      expect(requests).toEqual([]);
    });
    await browserPage(result,html.replace(/<li>one([^]*?)<\/li>/,'<aside>one$1</aside>'),executablePath,async(page,requests)=>{
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(['one','two']);
      expect(await page.$('aside')).toBeNull();
      await page.click('.reverse');await page.waitForFunction(()=>document.querySelector('li')?.textContent==='two');
      expect(await page.$eval('h1',node=>node.textContent)).toBe('Ada');expect(requests).toEqual([]);
    });
  },60_000);

  it('retains routing, Group request presentation and client navigation in Chrome', async context => {
    const result = await production('request-routes', `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}
      export function App(){const user=$fetch('/api/user');return <main route="/">
      <nav><a class="home" route-to="/demo/">Home</a><a class="about" route-to="/demo/about">About</a></nav>
      <section route="/demo/"><Group pending={Pending}><h1>{user?.name}</h1></Group></section>
      <section route="/demo/about"><h2>About directory</h2></section></main>;}`);
    expect(result.html).not.toContain('mmd:initial-delivery:');
    expect(result.files.some(file => file.type === 'chunk' && file.isEntry)).toBe(true);
    const response = await result.app.fetch(new Request('https://app.test/demo/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html.replace(/<!--[^]*?-->/g, '')).toContain('<h1>Ada</h1>');
    expect(html).toContain('application/mmd+json');
    const executablePath = chromeExecutable();
    if (!executablePath) { context.skip(); return; }
    await browserPage(result, html, executablePath, async (page, apiRequests) => {
      expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
      await page.click('.about'); await page.waitForSelector('h2');
      expect(await page.$eval('h2', node => node.textContent)).toBe('About directory');
      expect(new URL(page.url()).pathname).toBe('/demo/about');
      expect(await page.$('h1')).toBeNull();
      await page.click('.home'); await page.waitForSelector('h1');
      expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
      expect(apiRequests).toEqual([]);
    });
  }, 60_000);
});

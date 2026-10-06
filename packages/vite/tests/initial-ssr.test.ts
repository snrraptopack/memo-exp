import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build, type Rollup } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import memoizedDom from '../src';
import { routedApp, routedDetail, routedOpaque, initializeRoutedLifecycles, checkRoutedLifecycles } from './fixtures/routed-lifecycles';

let fixture: string | undefined;
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); fixture = undefined; });

async function production(name: string, source: string, extras: Record<string, string> = {}) {
  fixture = await mkdtemp(join(tmpdir(), 'memoized-dom-initial-ssr-'));
  await mkdir(join(fixture, 'src'));
  await writeFile(join(fixture, 'index.html'), '<!doctype html><html><head><title>SSR</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="./src/main.ts"></script></body></html>');
  await writeFile(join(fixture, 'src/main.ts'), `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`);
  await writeFile(join(fixture, 'src/App.tsx'), source);
  for (const [file, content] of Object.entries(extras)) await writeFile(join(fixture, file), content);
  await writeFile(join(fixture, 'server.ts'), `import {serve} from '@memoized-dom/server';import {App} from './src/App';const app=serve();app.get('/api/user',()=>({name:'Ada'}));app.ssr(App);export default app;`);
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
    base: '/demo/', plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'server.ts' })] });
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
  check: (page: Page, apiRequests: string[]) => Promise<void>, pathname = '/demo/'): Promise<void> {
  const apiRequests: string[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url?.replace(/^\/demo\//, '');
    if (request.url?.startsWith('/api/')) apiRequests.push(request.url);
    const asset = result.files.find(file => file.fileName === path);
    if (request.url?.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ name: 'Unexpected client fetch' }));
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
    await check(page, apiRequests);
    expect(errors).toEqual([]);
  } finally {
    try { await browser.close(); } finally { await new Promise<void>(done => server.close(() => done())); }
  }
}

describe('production initial SSR bootstrap', () => {
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

  it('restores request data and retains server nodes through ordinary hydration in Chrome', async context => {
    const cards = Array.from({length:16}, (_, index) =>
      `<article data-card="${index}"><h2>Card ${index}</h2><p>Ready &amp; waiting.</p></article>`).join('');
    const result = await production('request-data', `export function App(){const user=$fetch('/api/user');let count=0;return <main>
      <h1>{user?.name}</h1><button onClick={()=>count++}>{count}</button><section>${cards}</section></main>;}`);
    expect(result.html).not.toContain('mmd:initial-delivery:');
    expect(result.files.filter(file => file.type === 'chunk' && file.isEntry)).toHaveLength(1);
    const html = await (await result.app.fetch(new Request('https://app.test/demo/'))).text();
    expect(html.replace(/<!--[^]*?-->/g, '')).toContain('<h1>Ada</h1>');
    expect(html).toContain('mmd:r:App');
    expect(html).toContain('application/mmd+json');
    expect(result.files.filter(file => file.type === 'chunk').map(file => file.code).join('\n'))
      .toContain('Ready &amp; waiting.');
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

  it('selects keyed-list adoption, retains row identity and recovers mismatched rows in Chrome', async context => {
    const executablePath=chromeExecutable();if(!executablePath){context.skip();return;}
    const result=await production('request-list',`export function App(){const user=$fetch('/api/user');
      let rows=[{id:1,label:'one'},{id:2,label:'two'}];return <main><h1>{user?.name}</h1>
        <button class="reverse" onClick={()=>rows=rows.toReversed()}>Reverse</button>
        <button class="append" onClick={()=>rows=[...rows,{id:3,label:'three'}]}>Append</button>
        <ul>{rows.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}`);
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
    await browserPage(result,html.replace('<li>one</li>','<aside>one</aside>'),executablePath,async(page,requests)=>{
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

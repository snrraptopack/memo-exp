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
  check: (page: Page, apiRequests: string[]) => Promise<void>): Promise<void> {
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
    await page.goto(`http://127.0.0.1:${address.port}/demo/`);
    await check(page, apiRequests);
    expect(errors).toEqual([]);
  } finally {
    try { await browser.close(); } finally { await new Promise<void>(done => server.close(() => done())); }
  }
}

describe('production initial SSR bootstrap', () => {
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

  it('restores request data and retains server nodes through ordinary hydration in Chrome', async context => {
    const cards = Array.from({length:16}, (_, index) =>
      `<article data-card="${index}"><h2>Card ${index}</h2><p>{'Ready & waiting.'}</p></article>`).join('');
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
});

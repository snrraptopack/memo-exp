import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { build, createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import memoizedDom from '../src';
import { applyInitialPage } from '../src/initial-html';

const runtime = resolve(import.meta.dirname, '../../runtime/src/index.ts');
const runtimeHot = resolve(import.meta.dirname, '../../runtime/src/hot.ts');
const fixtures: string[] = [];
afterEach(async () => {
  for (const directory of fixtures.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(app: string, modules: Record<string, string> = {}, entry = '') {
  const root = await mkdtemp(join(tmpdir(), 'memoized-dom-initial-html-'));
  fixtures.push(root);
  await mkdir(resolve(root, 'src'));
  const files = {
    'index.html': `<!doctype html><html><head><title>Test</title></head><body><div id="root"></div><script type="module" src="./src/main.ts"></script></body></html>`,
    'src/main.ts': `import {mount} from '@memoized-dom/runtime'; import {App} from './App'; ${entry} mount('root',App);`,
    'src/App.tsx': app, ...modules,
  };
  await Promise.all(Object.entries(files).map(([file, code]) => writeFile(resolve(root, file), code)));
  return root;
}

function options(root: string) {
  return { root, configFile: false as const, logLevel: 'silent' as const,
    resolve: { alias: [
      { find: '@memoized-dom/runtime/hot', replacement: runtimeHot },
      { find: '@memoized-dom/runtime', replacement: runtime },
    ] },
    plugins: [memoizedDom({ clientEntry: 'src/main.ts' })],
  };
}

async function production(root: string) {
  const result = await build({ ...options(root), build: { write: false } });
  const files = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const html = String(files.find(file => file.type === 'asset' && file.fileName === 'index.html')?.source);
  return { files, html };
}

describe('HTML first production builds', () => {
  it('ships static hello as HTML with zero JavaScript assets', async () => {
    const result = await production(await fixture(`export function App(){return <h1>Hello</h1>;}`));
    expect(result.html).toContain('<div id="root"><h1>Hello</h1></div>');
    expect(result.html).not.toMatch(/<script|modulepreload/);
    expect(result.files.filter(file => file.type === 'chunk' || /\.m?js$/.test(file.fileName))).toEqual([]);
  });

  it('keeps a larger composed static page at zero JavaScript and preserves CSS', async () => {
    const root = await fixture(`import './page.css'; import {Card} from './Card';
      export function App(){return <main><h1>Hello</h1>${Array.from({length: 40}, (_, index) => `<Card title="Card ${index}"/>`).join('')}</main>;}`, {
      'src/Card.tsx': `export function Card({title}){return <section><h2>{title}</h2><p>Static content</p></section>;}`,
      'src/page.css': `h1{color:rgb(1,2,3)}`,
    });
    const result = await production(root);
    expect(result.html.match(/<section>/g)).toHaveLength(40);
    expect(result.html).toContain('Card 39');
    expect(result.html).toContain('rel="stylesheet"');
    expect(result.files.some(file => file.fileName.endsWith('.css'))).toBe(true);
    expect(result.files.some(file => file.type === 'chunk')).toBe(false);
  });

  it('preserves parser-extracted component styles without shipping the factory', async () => {
    const result = await production(await fixture('', {
      'src/main.ts': `import {mount} from '@memoized-dom/runtime'; import {App} from './App.tsrx'; mount('root',App);`,
      'src/App.tsrx': `export function App() @{<main class="hello"><style>.hello { color: red; }</style><h1>Hello</h1></main>}`,
    }));
    expect(result.html).toMatch(/<h1 class="tsrx-[a-f0-9]+">Hello<\/h1>/);
    expect(result.files.some(file => file.fileName.endsWith('.css'))).toBe(true);
    expect(result.files.some(file => file.type === 'chunk')).toBe(false);
  });

  it('retains the browser program for an interactive descendant', async () => {
    const root = await fixture(`import {Counter} from './Counter'; export function App(){return <main><h1>Hello</h1><Counter/></main>;}`, {
      'src/Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    });
    const result = await production(root);
    expect(result.html).toContain('<script');
    expect(result.html).not.toContain('<h1>Hello</h1>');
    expect(result.files.some(file => file.type === 'chunk')).toBe(true);
  });

  it('retains browser lifecycle and entry side effects', async () => {
    for (const [app, entry] of [
      [`export function App(){$effect(()=>console.log('effect'));return <h1>Hello</h1>;}`, ''],
      [`export function App(){return <h1>Hello</h1>;}`, `globalThis.booted=true;`],
    ]) {
      const result = await production(await fixture(app!, {}, entry));
      expect(result.html).toContain('<script');
      expect(result.files.some(file => file.type === 'chunk')).toBe(true);
    }
  });

  it('leaves development mounting and HMR available', async () => {
    const root = await fixture(`export function App(){return <h1>Hello</h1>;}`);
    const server = await createServer(options(root));
    try {
      const result = await server.transformRequest('/src/App.tsx');
      expect(result?.code).toContain('registerRootFactory');
      expect(result?.code).toContain('import.meta.hot');
      const html = await server.transformIndexHtml('/', '<html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
      expect(html).toContain('/src/main.ts');
      expect(html).not.toContain('<h1>Hello</h1>');
    } finally { await server.close(); }
  });

  it('renders the production HTML with browser JavaScript disabled', async context => {
    const executablePath = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
      .find((path): path is string => !!path && existsSync(path));
    if (!executablePath) { context.skip(); return; }
    const result = await production(await fixture(`import './page.css'; export function App(){return <h1>Hello</h1>;}`, {
      'src/page.css': 'h1{color:rgb(1,2,3)}',
    }));
    const server = createHttpServer((request, response) => {
      const path = request.url === '/' ? 'index.html' : request.url?.slice(1);
      const file = result.files.find(item => item.fileName === path);
      if (!file || file.type !== 'asset') { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', file.fileName.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(file.source);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      const scripts: string[] = [];
      page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      await page.goto(`http://127.0.0.1:${address.port}/`);
      expect(await page.$eval('#root h1', element => element.textContent)).toBe('Hello');
      expect(await page.$eval('h1', element => getComputedStyle(element).color)).toBe('rgb(1, 2, 3)');
      expect(scripts).toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    }
  });
});

describe('conservative shell adoption', () => {
  const root = resolve('/fixture');
  const page = { entry: resolve(root, 'main.ts').replaceAll('\\', '/'), target: 'root', html: '<h1>Hello</h1>' };
  const filename = resolve(root, 'index.html');
  function apply(body: string, head = '') {
    return applyInitialPage(`<html><head>${head}</head><body>${body}</body></html>`, filename, root, page, new Set());
  }
  const script = '<script type="module" src="./main.ts"></script>';
  it('handles quoted > and skips comments and raw text while locating the host', () => {
    expect(apply(`<!-- <div id="root"></div> --><div title="a > b" id="root"></div>${script}`, '<style>body::after{content:"<div>"}</style>'))
      .toContain('<div title="a > b" id="root"><h1>Hello</h1></div>');
  });
  it.each([
    `<div id="root">Existing content</div>`, `<div id="root"></div><div id="root"></div>`,
    `<template><div id="root"></div></template>`, `<div id="root"/>`, `<div id="root" id="other"></div>`,
    `<div id="root"></div><script>console.log('preserve me')</script>`,
  ])('keeps the browser entry for an unproven shell: %s', body => {
    expect(apply(body + script)).toBeNull();
  });
});

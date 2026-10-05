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
      { find: '@memoized-dom/data/internal', replacement: resolve(import.meta.dirname, '../../data/src/internal.ts') },
      { find: '@memoized-dom/data', replacement: resolve(import.meta.dirname, '../../data/src/index.ts') },
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
  it('retains the browser program for request data without a paired server entry', async () => {
    const result = await production(await fixture(`export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`));
    expect(result.files.some(file => file.type === 'chunk' && file.isEntry)).toBe(true);
    expect(result.html).toMatch(/<script[^>]+src=/);
    expect(result.html).not.toContain('mmd:initial-delivery:');
  });

  it('binds nested composed children without creating their initial elements in Chrome', async context => {
    const executablePath = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
      .find((path): path is string => !!path && existsSync(path));
    if (!executablePath) { context.skip(); return; }
    const result = await production(await fixture(`import {Counter} from './Counter';import {name,rename} from './state';
      export function App(){return <main><h1>{name}</h1><Counter offset={2} run={rename}/><Counter offset={10} run={rename}/></main>;}`, {
      'src/Counter.tsx': `import {Value} from './Value';export function Counter({offset,run}){let n=0;return <section>
        <button class="add" onClick={()=>n++}>Add</button><button class="rename" onClick={run}>Rename</button><Value text={n+offset}/></section>;}`,
      'src/Value.tsx': `export function Value({text}){return <strong>{text}</strong>;}`,
      'src/state.ts': `export let name='Ada';export function rename(){name='Grace';}`,
    }));
    expect(result.html).toContain('<strong>2</strong>');
    const server = createHttpServer((request, response) => {
      const file = result.files.find(item => item.fileName === (request.url === '/' ? 'index.html' : request.url?.slice(1)));
      if (!file) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', file.type === 'chunk' ? 'text/javascript' : 'text/html');
      response.end(file.type === 'chunk' ? file.code : file.source);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      const url = `http://127.0.0.1:${address.port}/`;
      const staticPage = await browser.newPage(); await staticPage.setJavaScriptEnabled(false); await staticPage.goto(url);
      expect(await staticPage.$$eval('strong', nodes => nodes.map(node => node.textContent))).toEqual(['2', '10']);
      await staticPage.close();
      const page = await browser.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.evaluateOnNewDocument(() => {
        const state = window as unknown as { initial?: Element[]; created?: string[] }; state.created = [];
        const create = document.createElement.bind(document);
        document.createElement = ((...args: Parameters<Document['createElement']>) => {
          state.created!.push(args[0]); return create(...args);
        }) as Document['createElement'];
        new MutationObserver(() => {
          if (document.querySelectorAll('strong').length === 2) state.initial ??= [...document.querySelectorAll('#root *')];
        }).observe(document, { subtree: true, childList: true });
      });
      await page.goto(url); await page.click('.add');
      await page.waitForFunction(() => document.querySelector('strong')?.textContent === '3');
      expect(await page.$$eval('strong', nodes => nodes.map(node => node.textContent))).toEqual(['3', '10']);
      await page.click('.rename'); await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Grace');
      expect(await page.evaluate(() => {
        const state = window as unknown as { initial: Element[]; created: string[] };
        const current = [...document.querySelectorAll('#root *')];
        return { same: state.initial.length === current.length && current.every((node, index) => node === state.initial[index]),
          created: state.created.filter(tag => tag !== 'link') };
      })).toEqual({ same: true, created: [] });
      expect(errors).toEqual([]);
    } finally {
      await browser.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    }
  });
  it('binds controlled input values and empty todo extents in Chrome',async context=>{
    const executablePath=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
      .find(path=>path&&existsSync(path));
    if (!executablePath) {context.skip();return;}
    const result=await production(await fixture(`export function App(){let items=[];let temp='seed';let open=true;return <main>
      <h1>Static todo surroundings</h1><form><input class="todo" type="text" value={temp} onInput={e=>{temp=e.target.value;}}/></form>
      <button class="add" onClick={()=>{if(!temp.trim())return;items=[...items,temp];temp='';}}>Add</button>
      <button class="clear" onClick={()=>{items=[];}}>Clear</button><ul>{items.map((item,index)=><li key={index}>{index}-{item}</li>)}</ul>
      <button class="toggle" onClick={()=>{open=!open;}}>Toggle</button>
      {open?<section><input class="branch" value={temp} onInput={e=>{temp=e.target.value;}}/></section>:null}<p>{temp}</p></main>;}`));
    expect(result.html).toContain('value="seed"');expect(result.html).toContain('mmd:initial:list:');
    expect(result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n')).not.toContain('Static todo surroundings');
    const server=createHttpServer((request,response)=>{
      const file=result.files.find(item=>item.fileName===(request.url==='/'?'index.html':request.url?.slice(1)));
      if (!file) {response.writeHead(404).end();return;}
      response.setHeader('Content-Type',file.type==='chunk'?'text/javascript':'text/html');
      response.end(file.type==='chunk'?file.code:file.source);
    });
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const browser=await puppeteer.launch({executablePath,headless:true});
    try {
      const address=server.address();if(!address||typeof address==='string')throw new Error('Missing HTTP address');
      const url=`http://127.0.0.1:${address.port}/`;
      const staticPage=await browser.newPage();await staticPage.setJavaScriptEnabled(false);await staticPage.goto(url);
      expect(await staticPage.$eval('.todo',node=>(node as HTMLInputElement).value)).toBe('seed');
      expect(await staticPage.$$eval('li',nodes=>nodes.length)).toBe(0);await staticPage.close();
      const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
      await page.evaluateOnNewDocument(()=>{
        const state=window as unknown as {field?:Element;heading?:Element;created?:string[]};state.created=[];
        const create=document.createElement.bind(document);
        document.createElement=((...args:Parameters<Document['createElement']>)=>{state.created!.push(args[0]);return create(...args);}) as Document['createElement'];
        new MutationObserver(()=>{
          state.field??=document.querySelector('.todo')??undefined;state.heading??=document.querySelector('h1')??undefined;
        }).observe(document,{subtree:true,childList:true});
      });
      await page.goto(url);await page.waitForSelector('.todo');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {field:HTMLInputElement;created:string[]};const field=document.querySelector<HTMLInputElement>('.todo')!;
        return {same:field===state.field,value:field.value,defaultValue:field.defaultValue,attribute:field.getAttribute('value'),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({same:true,value:'seed',defaultValue:'',attribute:null,created:[]});
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('li')?.textContent==='0-seed');
      expect(await page.$eval('.todo',node=>(node as HTMLInputElement).value)).toBe('');
      await page.evaluate(()=>{const field=document.querySelector<HTMLInputElement>('.todo')!;field.value='new';field.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('p')?.textContent==='new');
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('li:last-child')?.textContent==='1-new');
      await page.click('.toggle');await page.waitForFunction(()=>document.querySelector('.branch')===null);
      await page.click('.toggle');await page.waitForSelector('.branch');
      expect(await page.$eval('.branch',node=>[(node as HTMLInputElement).value,(node as HTMLInputElement).defaultValue])).toEqual(['','']);
      await page.evaluate(()=>{const field=document.querySelector<HTMLInputElement>('.todo')!;field.value='again';field.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForFunction(()=>document.querySelector('p')?.textContent==='again');
      await page.evaluate(()=>document.querySelector('form')!.reset());
      expect(await page.$eval('.todo',node=>(node as HTMLInputElement).value)).toBe('');
      await page.click('.clear');await page.waitForFunction(()=>document.querySelectorAll('li').length===0);
      expect(await page.evaluate(()=>{
        const state=window as unknown as {field:Element;heading:Element};
        return state.field===document.querySelector('.todo')&&state.heading===document.querySelector('h1');
      })).toBe(true);expect(errors).toEqual([]);
    } finally {
      await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
    }
  });
  it('binds both list identity modes in Chrome and creates only later rows',async context=>{
    const executablePath=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
      .find(path=>path&&existsSync(path));
    if (!executablePath) {context.skip();return;}
    const result=await production(await fixture(`export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];let selected='none';return <main>
      <h1>Static list surroundings</h1><button class="reverse" onClick={()=>{items=[...items].reverse();}}>Reverse</button>
      <button class="replace" onClick={()=>{items=items.map(item=>({...item,label:item.label+'!'}));}}>Replace</button>
      <button class="append" onClick={()=>{items=[...items,{id:3,label:'three'}];}}>Append</button>
      <button class="clear" onClick={()=>{items=[];}}>Clear</button><ul class="keyed">
      {items.map((item,index)=><li key={item.id} title={item.label}><b>Row: </b><button onClick={()=>{selected=item.label;}}>{index}:{item.label}</button></li>)}</ul>
      <ul class="positional">{items.map((item,index)=><li key={index} title={item.label}><b>Row: </b><span>{index}:{item.label}</span></li>)}</ul>
      <p>{selected}</p></main>;}`));
    expect(result.html).toContain('mmd:initial:list:');
    expect(result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n')).not.toContain('Static list surroundings');
    const server=createHttpServer((request,response)=>{
      const file=result.files.find(item=>item.fileName===(request.url==='/'?'index.html':request.url?.slice(1)));
      if (!file) {response.writeHead(404).end();return;}
      response.setHeader('Content-Type',file.type==='chunk'?'text/javascript':'text/html');
      response.end(file.type==='chunk'?file.code:file.source);
    });
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const browser=await puppeteer.launch({executablePath,headless:true});
    try {
      const address=server.address();if(!address||typeof address==='string')throw new Error('Missing HTTP address');
      const url=`http://127.0.0.1:${address.port}/`;
      const staticPage=await browser.newPage();await staticPage.setJavaScriptEnabled(false);await staticPage.goto(url);
      expect(await staticPage.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(['Row: 0:one','Row: 1:two','Row: 0:one','Row: 1:two']);
      await staticPage.close();
      const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
      await page.evaluateOnNewDocument(()=>{
        const state=window as unknown as {rows?:Element[];heading?:Element;created?:string[]};state.created=[];
        const create=document.createElement.bind(document);
        document.createElement=((...args:Parameters<Document['createElement']>)=>{state.created!.push(args[0]);return create(...args);}) as Document['createElement'];
        new MutationObserver(()=>{
          if (document.querySelectorAll('li').length===4) state.rows??=[...document.querySelectorAll('li')];
          state.heading??=document.querySelector('h1')??undefined;
        }).observe(document,{subtree:true,childList:true});
      });
      await page.goto(url);await page.waitForSelector('li');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {rows:Element[];created:string[]};
        return {same:state.rows.every((row,index)=>row===document.querySelectorAll('li')[index]),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({same:true,created:[]});
      await page.click('.reverse');await page.waitForFunction(()=>document.querySelector('.keyed button')?.textContent==='0:two');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {rows:Element[]};const current=[...document.querySelectorAll('li')];
        return [state.rows[1],state.rows[0],state.rows[2],state.rows[3]].every((row,index)=>row===current[index]);
      })).toBe(true);
      await page.click('.replace');await page.waitForFunction(()=>document.querySelector('.positional li')?.getAttribute('title')==='two!');
      await page.click('.append');await page.waitForFunction(()=>document.querySelectorAll('li').length===6);
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(['Row: 0:two!','Row: 1:one!','Row: 2:three','Row: 0:two!','Row: 1:one!','Row: 2:three']);
      await page.click('.keyed li:last-child button');await page.waitForFunction(()=>document.querySelector('p')?.textContent==='three');
      await page.click('.clear');await page.waitForFunction(()=>document.querySelectorAll('li').length===0);
      await page.click('.append');await page.waitForFunction(()=>document.querySelectorAll('li').length===2);
      expect(await page.$$eval('li',nodes=>nodes.map(node=>node.textContent))).toEqual(['Row: 0:three','Row: 0:three']);
      expect(await page.evaluate(()=>(window as unknown as {heading:Element}).heading===document.querySelector('h1'))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
    }
  });

  it('ships a closed list with composed rows as HTML and zero JavaScript',async()=>{
    const result=await production(await fixture(`function Row({title}){return <li>{title}</li>;}export function App(){
      const items=[{id:1,title:'one'},{id:2,title:'two'}];return <ul>{items.map(item=><Row key={item.id} title={item.title}/>)}</ul>;}`));
    expect(result.html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(result.files.some(file=>file.type==='chunk')).toBe(false);
  });
  it('binds conditional HTML in Chrome and recreates only the switched branch',async context=>{
    const executablePath=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
      .find(path=>path&&existsSync(path));
    if (!executablePath) {context.skip();return;}
    const result=await production(await fixture(`export function App(){let open=true;let n=1;return <main>
      <h1>Retained surrounding content</h1><button class="toggle" onClick={()=>{open=!open;}}>Toggle</button>
      {open?<section title="Current branch"><b>Branch label</b><button class="add" onClick={()=>n++}>{n}</button></section>:<p>Closed</p>}
      <span>{n}</span></main>;}`));
    expect(result.html).toContain('<section title="Current branch"><b>Branch label</b><button class="add">1</button></section>');
    const js=result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('\n');
    expect(js).not.toContain('Retained surrounding content');
    const server=createHttpServer((request,response)=>{
      const path=request.url==='/'?'index.html':request.url?.slice(1);
      const file=result.files.find(item=>item.fileName===path);
      if (!file) {response.writeHead(404).end();return;}
      response.setHeader('Content-Type',file.type==='chunk'?'text/javascript':'text/html');
      response.end(file.type==='chunk'?file.code:file.source);
    });
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const browser=await puppeteer.launch({executablePath,headless:true});
    try {
      const address=server.address();if(!address||typeof address==='string')throw new Error('Missing HTTP address');
      const url=`http://127.0.0.1:${address.port}/`;
      const staticPage=await browser.newPage();await staticPage.setJavaScriptEnabled(false);await staticPage.goto(url);
      expect(await staticPage.$eval('.add',node=>node.textContent)).toBe('1');await staticPage.close();
      const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
      await page.evaluateOnNewDocument(()=>{
        const state=window as unknown as {originalMain?:Element;originalHeading?:Element;originalBranch?:Element;created?:string[]};
        state.created=[];
        const create=document.createElement.bind(document);
        document.createElement=((...args:Parameters<Document['createElement']>)=>{state.created!.push(args[0]);return create(...args);}) as Document['createElement'];
        new MutationObserver(()=>{
          state.originalMain??=document.querySelector('#root main')??undefined;
          state.originalHeading??=document.querySelector('#root h1')??undefined;
          state.originalBranch??=document.querySelector('#root section')??undefined;
        }).observe(document,{subtree:true,childList:true});
      });
      await page.goto(url);await page.waitForSelector('.add');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {originalBranch:Element;created:string[]};
        // Vite's modulepreload feature probe creates a detached link.
        return {same:state.originalBranch===document.querySelector('section'),created:state.created.filter(tag=>tag!=='link')};
      })).toEqual({same:true,created:[]});
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('.add')?.textContent==='2');
      await page.click('.toggle');await page.waitForSelector('p');
      expect(await page.$('section')).toBeNull();
      await page.click('.toggle');await page.waitForSelector('.add');
      expect(await page.$eval('.add',node=>node.textContent)).toBe('2');
      expect(await page.$eval('section',node=>node.getAttribute('title'))).toBe('Current branch');
      expect(await page.$eval('b',node=>node.textContent)).toBe('Branch label');
      await page.click('.add');await page.waitForFunction(()=>document.querySelector('span')?.textContent==='3');
      expect(await page.evaluate(()=>{
        const state=window as unknown as {originalMain:Element;originalHeading:Element;originalBranch:Element};
        return state.originalMain===document.querySelector('main')&&state.originalHeading===document.querySelector('h1')&&
          state.originalBranch!==document.querySelector('section');
      })).toBe(true);expect(errors).toEqual([]);
    } finally {
      await browser.close();await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
    }
  });

  it('ships static hello as HTML with zero JavaScript assets', async () => {
    const result = await production(await fixture(`export function App(){return <h1>Hello</h1>;}`));
    expect(result.html).toContain('<div id="root"><h1>Hello</h1></div>');
    expect(result.html).not.toMatch(/<script|modulepreload/);
    expect(result.files.filter(file => file.type === 'chunk' || /\.m?js$/.test(file.fileName))).toEqual([]);
  });

  it('ships unchanged variables and derived constants with zero JavaScript', async () => {
    const result = await production(await fixture(`export function App(){let name='Ada';const greeting='Hello '+name;
      return <h1>{greeting}</h1>;}`));
    expect(result.html).toContain('<h1>Hello Ada</h1>');
    expect(result.files.some(file => file.type === 'chunk')).toBe(false);
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

  it('ships a static ancestor as HTML with a separate interactive descendant program', async () => {
    const root = await fixture(`import {Counter} from './Counter'; export function App(){return <main><h1>Hello</h1><Counter/></main>;}`, {
      'src/Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    });
    const result = await production(root);
    expect(result.html).toContain('<script');
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('<button>0</button>');
    expect(result.files.some(file => file.type === 'chunk')).toBe(true);
    expect(result.files.filter(file => file.type === 'chunk').map(file => file.code).join('\n')).not.toContain('Hello');
  });

  it('keeps JavaScript independent of a growing static composition around the same counter', async () => {
    const bytes: number[] = [];
    for (const count of [1, 60]) {
      const result = await production(await fixture(`import {Counter} from './Counter';import {Card} from './Card';
        export function App(){return <main>${Array.from({length:count}, (_, index) => `<Card title="Static card ${index}"/>`).join('')}<Counter/></main>;}`, {
        'src/Card.tsx': `export function Card({title}){return <section><h2>{title}</h2><p>Static body.</p></section>;}`,
        'src/Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
      }));
      expect(result.html.match(/<section>/g)).toHaveLength(count);
      const js = result.files.filter(file => file.type === 'chunk').map(file => file.code).join('');
      expect(js).not.toContain('Static card');
      expect(js).not.toContain('Static body');
      bytes.push(Buffer.byteLength(js));
    }
    expect(Math.abs(bytes[1]! - bytes[0]!)).toBeLessThan(128);
  });

  it('retains the original HTML nodes while mounting independent interactive children in Chrome', async context => {
    const executablePath = [process.env.MMD_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
      .find((path): path is string => !!path && existsSync(path));
    if (!executablePath) { context.skip(); return; }
    const result = await production(await fixture(`import {Counter} from './Counter';export function App(){let name='Ada';
      return <main><h1>{'Hello '+name}</h1><Counter offset={0} live={false}/><Counter offset={2} live={true}/><Counter offset={10} live={true}/></main>;}`, {
      'src/Counter.tsx': `export function Counter({offset,live}){let n=0;return <section>{live?<button onClick={()=>n++}>{n+offset}</button>:<span>Static instance</span>}</section>;}`,
    }));
    const server = createHttpServer((request, response) => {
      const file = result.files.find(item => item.fileName === (request.url === '/' ? 'index.html' : request.url?.slice(1)));
      if (!file) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', file.type === 'chunk' ? 'text/javascript' : 'text/html');
      response.end(file.type === 'chunk' ? file.code : file.source);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const browser = await puppeteer.launch({executablePath, headless:true});
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.evaluateOnNewDocument(() => {
        const saved = window as unknown as {initialMain?:Element; initialHeading?:Element};
        new MutationObserver(() => {
          saved.initialMain ??= document.querySelector('#root main') ?? undefined;
          saved.initialHeading ??= document.querySelector('#root h1') ?? undefined;
        }).observe(document, {childList:true, subtree:true});
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForSelector('button');
      expect(await page.$$eval('button', nodes => nodes.map(node => node.textContent))).toEqual(['2','10']);
      const buttons=await page.$$('button');
      await buttons[0]!.click();
      await page.waitForFunction(() => document.querySelector('button')?.textContent === '3');
      expect(await page.$$eval('button', nodes => nodes.map(node => node.textContent))).toEqual(['3','10']);
      await buttons[1]!.click();
      await page.waitForFunction(() => document.querySelectorAll('button')[1]?.textContent === '11');
      expect(await page.evaluate(() => {
        const saved = window as unknown as {initialMain?:Element; initialHeading?:Element};
        return saved.initialMain === document.querySelector('#root main') && saved.initialHeading === document.querySelector('#root h1');
      })).toBe(true);
      expect(await page.$eval('#root', node => [...node.childNodes].filter(child => child.nodeType === 8).length)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
    }
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

  it('keeps direct event-program size independent of surrounding static markup', async () => {
    const bytes: number[] = [];
    for (const count of [1,60]) {
      const result=await production(await fixture(`export function App(){let n=0;return <main>
        ${Array.from({length:count},(_,index)=>`<section><h2>Static card ${index}</h2><p>Ready.</p></section>`).join('')}
        <button onClick={()=>n++}>Add</button><p>{n}</p></main>;}`));
      expect(result.html.match(/<section>/g)).toHaveLength(count);
      expect(result.html).toContain('<p>0</p>');
      const js=result.files.filter(file=>file.type==='chunk').map(file=>file.code).join('');
      expect(js).not.toContain('Static card');
      expect(js).not.toContain('Ready.');
      bytes.push(Buffer.byteLength(js));
    }
    expect(Math.abs(bytes[1]! - bytes[0]!)).toBeLessThan(128);
  });

  it.each(['owner','module'])('binds %s state to initial DOM without recreating nodes in Chrome', async (placement,context) => {
    const executablePath=[process.env.MMD_CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium']
      .find((path):path is string=>!!path&&existsSync(path));
    if (!executablePath) {context.skip();return;}
    const state=`let n=1;let name='';`;
    const appSource=`${placement==='module'?state:''}
      export function App(){${placement==='owner'?state:''}const doubled=n*2;const alias=doubled;
        let fixed='Ada';const greeting='Hello '+fixed;return <main><h1 title={greeting}>{greeting}</h1><em>{alias}</em>
        <button id="add" onClick={()=>{n++;name='Ada';if(n===4){n=8;return;}n++;}}>Add</button>
        <p className={'count-'+n}>{n}{2} items</p><b>{n}{2}</b><span>{name}</span>
        <button id="fail" onClick={()=>{n=20;throw new Error('authored failure');}}>Fail</button>
        <button id="reset" onClick={()=>{n=0;name='';}}>Reset</button></main>;}`;
    const result=await production(await fixture(appSource));
    const baseline=await production(await fixture(appSource,{},`globalThis.creationTarget=true;`));
    expect(result.html).toContain('<p class="count-1">3 items</p>');
    const server=createHttpServer((request,response)=>{
      const file=request.url==='/creation' ? baseline.files.find(item=>item.fileName==='index.html') :
        [...result.files,...baseline.files].find(item=>item.fileName===(request.url==='/'?'index.html':request.url?.slice(1)));
      if (!file) {response.writeHead(404).end();return;}
      response.setHeader('Content-Type',file.type==='chunk'?'text/javascript':'text/html');
      response.end(file.type==='chunk'?file.code:file.source);
    });
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const browser=await puppeteer.launch({executablePath,headless:true});
    try {
      const address=server.address();
      if (!address||typeof address==='string') throw new Error('Missing HTTP address');
      const url=`http://127.0.0.1:${address.port}/`;
      const staticPage=await browser.newPage();
      await staticPage.setJavaScriptEnabled(false);
      await staticPage.goto(url);
      expect(await staticPage.$eval('#root',node=>node.textContent)).toBe('Hello Ada2Add3 items12FailReset');
      await staticPage.close();
      const ordinary=await browser.newPage();
      const ordinaryErrors:string[]=[];
      ordinary.on('pageerror',error=>ordinaryErrors.push(String(error)));
      await ordinary.goto(`${url}creation`);
      for (const n of [3,8,10]) {
        await ordinary.click('#add');
        await ordinary.waitForFunction(n=>document.querySelector('p')?.className===`count-${n}`,{},n);
      }
      await ordinary.click('#fail');
      // A subsequent successful handler establishes that error recovery still
      // works; the throw's DOM result must match the ordinary compiler target.
      const afterThrow=await ordinary.$eval('p',node=>node.textContent);
      await ordinary.click('#reset');
      await ordinary.waitForFunction(()=>document.querySelector('p')?.textContent==='2 items');
      expect(ordinaryErrors).toEqual(['Error: authored failure']);
      await ordinary.close();
      const page=await browser.newPage();
      const errors:string[]=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.evaluateOnNewDocument(()=>{
        const saved=window as unknown as {initial?:Node[]};
        new MutationObserver(()=>{
          const main=document.querySelector('main');
          const button=document.querySelector('#add');
          const text=document.querySelector('p')?.firstChild;
          if (main&&button&&text) saved.initial??=[main,button,text];
        }).observe(document,{childList:true,subtree:true});
      });
      await page.goto(url);
      for (const n of [3,8,10]) {
        await page.click('#add');
        await page.waitForFunction(n=>document.querySelector('p')?.className===`count-${n}`,{},n);
        expect(await page.$eval('p',node=>node.textContent)).toBe(`${n+2} items`);
        expect(await page.$eval('b',node=>node.textContent)).toBe(`${n}2`);
        expect(await page.$eval('span',node=>node.textContent)).toBe('Ada');
        expect(await page.$eval('em',node=>node.textContent)).toBe(String(n*2));
        expect(await page.$eval('h1',node=>[node.textContent,node.getAttribute('title')])).toEqual(['Hello Ada','Hello Ada']);
      }
      await page.click('#fail');
      expect(await page.$eval('p',node=>node.textContent)).toBe(afterThrow);
      await page.click('#reset');
      await page.waitForFunction(()=>document.querySelector('p')?.textContent==='2 items');
      expect(await page.$eval('span',node=>node.childNodes.length)).toBe(1);
      expect(await page.$eval('span',node=>node.textContent)).toBe('');
      expect(await page.$eval('em',node=>node.textContent)).toBe('0');
      expect(await page.evaluate(()=>{
        const saved=window as unknown as {initial?:Node[]};
        return saved.initial?.every((node,index)=>node===[document.querySelector('main'),document.querySelector('#add'),document.querySelector('p')?.firstChild][index]);
      })).toBe(true);
      expect(errors).toEqual(['Error: authored failure']);
    } finally {
      await browser.close();
      await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
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

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed, emitInitialHtml } from '@memoized-dom/compiler';
import { adoptInitialRoot } from '../packages/runtime/src/initial-root';
import { mountInitial, register, registerRootFactory, has, cleanup, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';

afterEach(() => document.body.replaceChildren());

describe('initial HTML ownership', () => {
  it('updates independently reasoned children after a static instance without replacing retained HTML', async () => {
    const runtimePath = '@memoized-dom/runtime/testing';
    const compiled = compileModulesDetailed({
      './main.ts': `import {mount} from '${runtimePath}';import {App} from './App';mount('root',App);`,
      './App.tsx': `import {Counter} from './Counter';export function App(){let name='Ada';
        return <main><h1>{'Hello '+name}</h1><Counter offset={0} live={false}/>
          <Counter offset={2} live={true}/><Counter offset={10} live={true}/></main>;}`,
      './Counter.tsx': `export function Counter({offset,live}){let n=0;return <section>
        {live?<button onClick={()=>n++}>{n+offset}</button>:<span>Static instance</span>}</section>;}`,
    }, { runtimePath });
    expect(compiled.initialRender.kind).toBe('mixed');
    const directory = resolve(import.meta.dirname, 'fixtures/out/initial-reasoned-children');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(compiled.initialBrowserOutput!)) {
      writeFileSync(resolve(directory, name), code);
    }
    document.body.innerHTML = `<div id="root">${emitInitialHtml(compiled.initialRender)}</div>`;
    const main = document.querySelector('main'), heading = document.querySelector('h1');
    const { App } = await import(/* @vite-ignore */ pathToFileURL(resolve(directory, 'App.tsx')).href);
    setScheduler(run => run());
    const app = mountInitial('root', App);
    try {
      const buttons = [...document.querySelectorAll('button')];
      expect(buttons.map(button => button.textContent)).toEqual(['2', '10']);
      buttons[0]!.click();
      expect(buttons.map(button => button.textContent)).toEqual(['3', '10']);
      buttons[1]!.click();
      expect(buttons.map(button => button.textContent)).toEqual(['3', '11']);
      expect(document.querySelector('main')).toBe(main);
      expect(document.querySelector('h1')).toBe(heading);
    } finally { app.unmount(); resetScheduler(); }
  });

  it('retains node identity and existing mount/unmount ownership without extra wrappers', () => {
    document.body.innerHTML='<div id="root"><main><h1>Hello Ada</h1><!--mmd:initial:0--></main></div>';
    const main=document.querySelector('main')!;
    const heading=document.querySelector('h1')!;
    const child=document.createElement('button');
    let cleanups=0;
    child.textContent='0';
    const App=()=>undefined;
    registerRootFactory(App, {id:'InitialApp',create(){
      register({id:'InitialApp',parent:null,render(){}});
      register({id:'InitialApp/Counter',parent:'InitialApp',render(){}});
      cleanup('InitialApp/Counter',()=>cleanups++);
      return adoptInitialRoot('root',[[0,child]]);
    }});
    const app=mountInitial('root',App);
    try {
      expect(document.querySelector('main')).toBe(main);
      expect(document.querySelector('h1')).toBe(heading);
      expect(main.children).toHaveLength(2);
      expect(app.nodes).toEqual([main]);
      expect(has('InitialApp/Counter')).toBe(true);
    } finally { app.unmount(); }
    expect(document.getElementById('root')!.childNodes).toHaveLength(0);
    expect(has('InitialApp/Counter')).toBe(false);
    expect(cleanups).toBe(1);
  });

  it.each([
    '<main><!--mmd:initial:1--></main>',
    '<main><!--mmd:initial:0--><!--mmd:initial:0--></main>',
    '<main><!--mmd:initial:0--><!--mmd:initial:1--></main>',
  ])('reports mismatched HTML before moving any retained nodes', html => {
    document.body.innerHTML=`<div id="root">${html}</div>`;
    const host=document.getElementById('root')!;
    const first=host.firstChild;
    expect(()=>adoptInitialRoot('root',[[0,document.createElement('button')]])).toThrow(/initial HTML/);
    expect(host.innerHTML).toBe(html);
    expect(host.firstChild).toBe(first);
  });
});

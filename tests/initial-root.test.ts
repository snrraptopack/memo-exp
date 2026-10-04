import { afterEach, describe, expect, it } from 'vitest';
import { adoptInitialRoot } from '../packages/runtime/src/initial-root';
import { mount, register, registerRootFactory, has, cleanup } from '@memoized-dom/runtime/testing';

afterEach(() => document.body.replaceChildren());

describe('initial HTML ownership', () => {
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
    const app=mount('root',App);
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

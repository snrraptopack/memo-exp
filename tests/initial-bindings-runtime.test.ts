import { afterEach, describe, expect, it } from 'vitest';
import { bindInitialNodes } from '../packages/runtime/src/initial-bindings';
import { mount, register, registerRootFactory, has, cleanup } from '@memoized-dom/runtime/testing';

afterEach(() => document.body.replaceChildren());

describe('initial DOM bindings', () => {
  it('retains existing nodes and normal mount/unmount ownership', () => {
    document.body.innerHTML='<div id="root"><main><h1>Hello</h1><button>Add</button><p>0</p></main></div>';
    const main=document.querySelector('main')!;
    const button=document.querySelector('button')!;
    const text=document.querySelector('p')!.firstChild!;
    const App=()=>undefined;
    let cleanups=0;
    registerRootFactory(App, {id:'BoundApp',create(){
      const nodes=bindInitialNodes('root',[[[0],'main'],[[0,1],'button'],[[0,2,0],'#text']]);
      register({id:'BoundApp',parent:null,render(){}});
      cleanup('BoundApp',()=>cleanups++);
      expect(nodes).toEqual([main,button,text]);
      return nodes[0]!;
    }});
    const app=mount('root',App);
    try {
      expect(app.nodes).toEqual([main]);
      expect(document.querySelector('button')).toBe(button);
      expect(document.querySelector('p')!.firstChild).toBe(text);
      expect(has('BoundApp')).toBe(true);
    } finally { app.unmount(); }
    expect(document.getElementById('root')!.childNodes).toHaveLength(0);
    expect(has('BoundApp')).toBe(false);
    expect(cleanups).toBe(1);
  });

  it('replaces an empty text marker once and preserves surrounding elements', () => {
    document.body.innerHTML='<div id="root"><main><p><!--mmd:empty--></p><b>Kept</b></main></div>';
    const kept=document.querySelector('b');
    const nodes=bindInitialNodes('root',[[[0,0,0],'#text'],[[0,0,0],'#text']]);
    expect(nodes[0]).toBe(nodes[1]);
    expect(nodes[0]!.nodeType).toBe(3);
    expect(document.querySelector('p')!.firstChild).toBe(nodes[0]);
    expect(document.querySelector('b')).toBe(kept);
  });

  it.each([[[0,1],'button'],[[0,4],'b'],[[0,-1],'b'],[[0,1.5],'b']] as const)(
    'validates every address before replacing markers: %j', (path,kind) => {
      document.body.innerHTML='<div id="root"><main><p><!--mmd:empty--></p><b>Kept</b></main></div>';
      const host=document.getElementById('root')!;
      const markup=host.innerHTML;
      const marker=document.querySelector('p')!.firstChild;
      expect(()=>bindInitialNodes('root',[[[0,0,0],'#text'],[path,kind]])).toThrow(/initial DOM binding/);
      expect(host.innerHTML).toBe(markup);
      expect(document.querySelector('p')!.firstChild).toBe(marker);
    },
  );
});

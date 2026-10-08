import { afterEach, describe, expect, it } from 'bun:test';
import { bindInitialNodes } from '../packages/runtime/src/initial-bindings';
import { bindInitialRegionNodes } from '../packages/runtime/src/initial-region-bindings';
import { mountInitial, register, registerRootFactory, has, cleanup } from '@memoized-dom/runtime/testing';

afterEach(() => document.body.replaceChildren());

describe('initial DOM bindings', () => {
  it.each([false,true])('resolves absent/present regions and independent variable siblings (%s)',present=>{
    document.body.innerHTML=`<main><p><!--mmd:empty--></p><!--mmd:initial:when:1:1-->${present?'<section>Shown</section>':''}<!--/mmd:initial:when-->
      <b>Between</b><!--mmd:initial:list:2:2--><em>One</em><em>Two</em><!--/mmd:initial:list--><footer>End</footer></main>`;
    const main=document.querySelector('main')!;
    const nodes=bindInitialRegionNodes(main,[
      [[0,0],'#text'],[[['mmd:initial:when:1:1',0]],'#comment:mmd:initial:when:1:1'],
      [[['mmd:initial:when:1:1',0,true]],'#comment:/mmd:initial:when'],
      [[['mmd:initial:list:2:2',0,true]],'#comment:/mmd:initial:list'],
      [[['mmd:initial:list:2:2',1,true]],'footer'],
    ]);
    expect(nodes[0]!.nodeType).toBe(3);expect(nodes[4]).toBe(main.querySelector('footer'));
    expect(nodes[1]!.nextSibling===nodes[2]).toBe(!present);
  });
  it.each(['missing','unclosed','mismatch','duplicate'])('rejects %s region addresses before replacing text markers',shape=>{
    const content=shape==='unclosed'?'<!--mmd:initial:when:1:1--><b/>':shape==='mismatch'
      ?'<!--mmd:initial:when:1:1--><!--/mmd:initial:list-->':shape==='duplicate'
      ?'<!--mmd:initial:when:1:1--><!--/mmd:initial:when--><!--mmd:initial:when:1:1--><!--/mmd:initial:when-->':'';
    document.body.innerHTML=`<main><p><!--mmd:empty--></p>${content}</main>`;
    const main=document.querySelector('main')!,marker=main.firstChild!.firstChild,html=main.innerHTML;
    expect(()=>bindInitialRegionNodes(main,[[[0,0],'#text'],[[['mmd:initial:when:1:1',0,true]],'#comment:/mmd:initial:when']])).toThrow(/initial region/);
    expect(main.innerHTML).toBe(html);expect(main.firstChild!.firstChild).toBe(marker);
  });
  it('validates structural comment identities without replacing them',()=>{
    document.body.innerHTML='<div id="root"><main><!--mmd:initial:when:1:2--><p>Ready</p><!--/mmd:initial:when--></main></div>';
    const main=document.querySelector('main')!;
    const nodes=bindInitialNodes('root',[[[0,0],'#comment:mmd:initial:when:1:2'],[[0,2],'#comment:/mmd:initial:when']]);
    expect(nodes).toEqual([main.firstChild,main.lastChild]);
    expect(()=>bindInitialNodes('root',[[[0,0],'#comment:mmd:initial:when:wrong']])).toThrow(/shape does not match/);
    expect(main.firstChild).toBe(nodes[0]);
  });
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
    const app=mountInitial('root',App);
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

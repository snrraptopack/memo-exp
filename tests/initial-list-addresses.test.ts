import {afterEach,expect,it} from 'vitest';
import {bindInitialListNodes} from '../packages/runtime/src/initial-list-bindings';

afterEach(()=>document.body.replaceChildren());
it.each([0,1,4])('resolves retained prefix/suffix nodes around %i initial rows',count=>{
  document.body.innerHTML=`<main><h1>Before</h1><!--mmd:initial:list:x-->${'<li>Row</li>'.repeat(count)}<!--/mmd:initial:list--><p><!--mmd:empty--></p><footer>After</footer></main>`;
  const main=document.querySelector('main')!,prefix=main.firstChild,suffix=main.lastChild;
  const nodes=bindInitialListNodes(main,[[[0],'h1'],[[-3],'#comment:/mmd:initial:list'],[[-2,0],'#text'],[[-1],'footer']]);
  expect(nodes[0]).toBe(prefix);expect(nodes[3]).toBe(suffix);
  expect(nodes[2]!.nodeType).toBe(3);expect(document.querySelectorAll('li')).toHaveLength(count);
});
it.each([-9,-0.5,Number.NaN,Number.POSITIVE_INFINITY])('rejects invalid relative index %s before changing any marker',index=>{
  document.body.innerHTML='<main><p><!--mmd:empty--></p><footer>After</footer></main>';
  const main=document.querySelector('main')!,marker=main.firstChild!.firstChild;
  expect(()=>bindInitialListNodes(main,[[[0,0],'#text'],[[index],'footer']])).toThrow(/binding path/);
  expect(main.firstChild!.firstChild).toBe(marker);
});
it('checks resolved node shapes before replacing an earlier empty marker',()=>{
  document.body.innerHTML='<main><p><!--mmd:empty--></p><footer>After</footer></main>';
  const main=document.querySelector('main')!,marker=main.firstChild!.firstChild;
  expect(()=>bindInitialListNodes(main,[[[0,0],'#text'],[[-1],'button']])).toThrow(/shape/);
  expect(main.firstChild!.firstChild).toBe(marker);
});

import { expect, it } from 'vitest';
import { installHydrationRuntime } from '../packages/runtime/src/mount';
import { hydrateList } from '../packages/runtime/src/hydration-list';
import { claimHydrationRoot, HydrationDocument } from '../packages/runtime/src/hydration';

it('retains installed list adoption when a later program only needs ordinary nodes', () => {
  const unused = () => { throw new Error('This test adopts directly'); };
  const first = installHydrationRuntime(unused, { list: hydrateList });
  const second = installHydrationRuntime(unused, {});
  expect(second).toBe(first);
  const host=document.createElement('div');
  host.innerHTML='<!--mmd:r:App--><ul><!--mmd:l:Rows--><!--mmd:w:Rows:n:0--><li>one</li><!--/mmd--></ul><!--/mmd-->';
  const row=host.querySelector('li');
  const documentPlan=new HydrationDocument(document,claimHydrationRoot(host,'App'),second);
  try {
    const list=documentPlan.claimList(host.querySelector('ul')!,'Rows');
    const adopted=list.adoptRow(0,'n:0',()=>{
      const text=documentPlan.createTextNode('one');
      const element=documentPlan.createElement('li');element.appendChild(text);return element;
    });
    expect(adopted.value).toBe(row);list.finish();
    expect(documentPlan.createElement('ul')).toBe(host.querySelector('ul'));
    documentPlan.expectDone();
  } finally {documentPlan.finishHydration();}
});

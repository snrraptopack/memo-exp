import { afterEach, expect, it } from 'vitest';
import { createCondRegion } from '@memoized-dom/runtime';

afterEach(()=>document.body.replaceChildren());
it('removes initial anchors when construction throws, including undefined',()=>{
  const host=document.createElement('main');document.body.append(host);let caught=false;
  try {createCondRegion(host,'condition',()=>0,[()=>{throw undefined;}]);}
  catch(error){caught=true;expect(error).toBeUndefined();}
  expect(caught).toBe(true);expect(host.childNodes).toHaveLength(0);
});
it('stays terminal when a selector unmounts the region',()=>{
  const host=document.createElement('main');document.body.append(host);let unmount=false,created=0;
  const region=createCondRegion(host,'condition',()=>{if(unmount)region.dispose();return 0;},[()=>{
    created++;return {nodes:[document.createElement('p')],update(){}};
  }]);
  unmount=true;region.update();region.update();
  expect(host.childNodes).toHaveLength(0);expect(created).toBe(1);expect(region.index()).toBe(-1);
});
it('cleans a branch returned after its factory unmounts the region',()=>{
  const host=document.createElement('main');document.body.append(host);let index=0,cleaned=0;
  const region=createCondRegion(host,'condition',()=>index,[
    ()=>({nodes:[document.createElement('p')],update(){},dispose(){cleaned++;}}),
    ()=>{const node=document.createElement('b');host.append(node);region.dispose();return {nodes:[node],update(){},dispose(){cleaned++;}};},
  ]);
  index=1;region.update();expect(host.childNodes).toHaveLength(0);expect(cleaned).toBe(2);
  region.dispose();expect(cleaned).toBe(2);
});
it('finishes DOM teardown when a branch disposer throws or calls dispose again',()=>{
  const host=document.createElement('main');document.body.append(host);let cleaned=0;
  const failure=new Error('cleanup');
  const region=createCondRegion(host,'condition',()=>0,[()=>({nodes:[document.createElement('p')],update(){},dispose(){
    cleaned++;region.dispose();throw failure;
  }})]);
  expect(()=>region.dispose()).toThrow(failure);expect(host.childNodes).toHaveLength(0);
  region.dispose();region.update();expect(cleaned).toBe(1);
});
it('preserves a thrown undefined and retries branch selection',()=>{
  const host=document.createElement('main');document.body.append(host);let index=0,fail=true;
  const region=createCondRegion(host,'condition',()=>index,[
    ()=>({nodes:[document.createElement('p')],update(){}}),
    ()=>{if(fail)throw undefined;const node=document.createElement('b');node.textContent='recovered';return {nodes:[node],update(){}};},
  ]);
  index=1;let caught=false;try {region.update();}catch(error){caught=true;expect(error).toBeUndefined();}
  expect(caught).toBe(true);fail=false;region.update();expect(host.querySelector('b')!.textContent).toBe('recovered');region.dispose();
});

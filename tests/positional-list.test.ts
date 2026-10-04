import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { createPositionalListRegion, createListRegion, resetScheduler, setScheduler,
  registeredIds, unregisterSubtree, type ListRegion } from '@memoized-dom/runtime/testing';

const regions: ListRegion<unknown>[] = [];
afterEach(() => {
  for (const region of regions.splice(0)) region.dispose();
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler(); document.body.replaceChildren();
});
function setup(positional = true, multi = false) {
  const host = document.createElement('ul');
  const before = document.createTextNode('before'), after = document.createTextNode('after');
  host.append(before); document.body.append(host);
  let onCreate = (_item: string, _index: number) => {};
  let onUpdate = (_item: string, _index: number) => {};
  const create = (item: string, _id: string, index: number) => {
    const node = document.createElement('li'); node.textContent = `${index}:${item}`;
    onCreate(item, index);
    return { nodes: multi ? [document.createTextNode('|'), node] : node, entities: [],
      update(next: unknown, i: number) { node.textContent = `${i}:${next}`; onUpdate(next as string, i); } };
  };
  const region = positional ? createPositionalListRegion(host, 'Position/items', create)
    : createListRegion(host, 'Position/items', create, (_item, index) => index, false, true, true);
  regions.push(region as ListRegion<unknown>); host.append(after);
  return { host, before, after, region, hooks(create = onCreate, update = onUpdate) {onCreate=create;onUpdate=update;} };
}

it.each([false,true])('matches index-keyed identity across replacement, reorder, duplicate values and shrink (multi=%s)', multi => {
  const small = setup(true,multi), keyed = setup(false,multi);
  const sequences = [['a','b','b'], ['b','a','b'], ['changed','a','b','b'], ['a'], [], ['b','b']];
  let prior: Element[] = [];
  for (const items of sequences) {
    small.region.reconcile(items); keyed.region.reconcile(items);
    expect(small.host.innerHTML).toBe(keyed.host.innerHTML);
    const current = [...small.host.querySelectorAll('li')];
    for (let i=0;i<Math.min(current.length,prior.length);i++) expect(current[i]).toBe(prior[i]);
    prior=current;
    expect(small.host.firstChild).toBe(small.before); expect(small.host.lastChild).toBe(small.after);
    expect(small.region.size()).toBe(items.length);
  }
});

it('keeps broad replay and targeted refresh honest', () => {
  const app=setup(), calls:number[]=[];
  app.region.reconcile(['a','b']); app.hooks(undefined, (_item,index)=>{calls.push(index);});
  app.region.reconcile(['a','b'],true); expect(calls).toEqual([]);
  app.region.reconcile(['a','b']); expect(calls).toEqual([0,1]);
  calls.length=0; app.region.refreshKey('0'); app.region.refreshKey(-1); app.region.refreshKey(0);
  expect(calls).toEqual([0]);
  app.region.refreshIndices(['new','b'],[1]);
  expect([...app.host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:new','1:b']);
});

it('rejects a non-array before disturbing the existing rows and allows retry', () => {
  const app=setup(); app.region.reconcile(['a']); const row=app.host.querySelector('li');
  expect(()=>app.region.reconcile({photos:[]} as unknown as string[])).toThrow(/requires an array/);
  expect(app.host.querySelector('li')).toBe(row);
  app.region.reconcile(['b']); expect(row!.textContent).toBe('0:b');
});

it('batches fresh and appended rows and leaves retained nodes untouched',()=>{
  const app=setup(); const insert=vi.spyOn(app.host,'insertBefore');
  app.region.reconcile(Array.from({length:100},(_,i)=>String(i)));
  expect(insert).toHaveBeenCalledTimes(1); insert.mockClear();
  const first=app.host.querySelector('li');
  app.region.reconcile(Array.from({length:110},(_,i)=>String(i)),true,true);
  expect(insert).toHaveBeenCalledTimes(1);expect(app.host.querySelector('li')).toBe(first);
  insert.mockClear();app.region.reconcile(Array.from({length:110},(_,i)=>String(i)),true);
  expect(insert).not.toHaveBeenCalled();insert.mockRestore();
});

it('recovers a failed appended factory without losing or recreating retained rows', () => {
  const app=setup(); app.region.reconcile(['a']); const first=app.host.querySelector('li');
  let fail=true; app.hooks(item=>{if(item==='c'&&fail)throw new Error('factory');});
  expect(()=>app.region.reconcile(['a','b','c'])).toThrow('factory');
  fail=false; app.region.reconcile(['a','b','c'],true,true);
  expect(app.host.querySelector('li')).toBe(first);
  expect([...app.host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:a','1:b','2:c']);
});

it('replays a retained row after a thrown update and hides consumed rows from refresh', () => {
  const app=setup(); app.region.reconcile(['a','b']); let fail=true, calls=0;
  app.hooks(undefined,(_item,index)=>{calls++;app.region.refreshKey(index);if(index===0&&fail)throw new Error('update');});
  expect(()=>app.region.reconcile(['x','y'])).toThrow('update');
  fail=false; app.region.reconcile(['x','y'],true); expect(calls).toBe(3);
  expect([...app.host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:x','1:y']);
});

it.each(['create','update'] as const)('stays terminal when %s unmounts the region', action => {
  const app=setup(); app.region.reconcile(['a']);
  app.hooks(action==='create'?()=>app.region.dispose():undefined, action==='update'?()=>app.region.dispose():undefined);
  app.region.reconcile(action==='create'?['a','b']:['changed']);
  expect(app.region.size()).toBe(0);
  expect(app.host.childNodes).toHaveLength(2);
  app.region.reconcile(['never']); expect(app.host.querySelector('li')).toBeNull();
});

it('does not overwrite a nested reconcile after a retained updater returns', () => {
  const app=setup(); app.region.reconcile(['a','b']); let once=true;
  app.hooks(undefined,()=>{if(once){once=false;app.region.reconcile(['nested']);}});
  app.region.reconcile(['outer','stale']);
  expect([...app.host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:nested']);
});

it('stops targeted replay when an updater replaces the complete frame',()=>{
  const app=setup(); app.region.reconcile(['a','b']); let once=true;
  app.hooks(undefined,()=>{if(once){once=false;app.region.reconcile(['nested','current']);}});
  app.region.refreshIndices(['a','b'],[0,1],true);
  expect([...app.host.querySelectorAll('li')].map(node=>node.textContent)).toEqual(['0:nested','1:current']);
});

it.each([
  ['<li key={index}>{item}</li>',true],
  ['<li>{item}</li>',false],
  ['<li key={item}>{item}</li>',false],
  ['<li key={index} ref={node=>{}}>{item}</li>',false],
  ['<li key={index} {...{title:item}}>{item}</li>',false],
] as const)('selects the capability conservatively: %s',(row,positional)=>{
  const code=compile(`export function App(){let items=['a','b'];return <main>
    <button onClick={()=>{items=[...items,'b'];}}>Add</button><ul>{items.map((item,index)=>${row})}</ul></main>;}`);
  expect(code.includes('.createPositionalListRegion(')).toBe(positional);
  expect(code.includes('.createListRegion(')).toBe(!positional);
});

it('compiles and runs independent positional and keyed regions with retained DOM and current event captures', async () => {
  const directory=join(import.meta.dirname,'fixtures/out/positional-list'); mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'app.ts'),compile(`export function App(){let items=['a','b'];
    return <main><button class="reverse" onClick={()=>{items=[...items].reverse();}}>Reverse</button>
      <button class="append" onClick={()=>{items=[...items,'b'];}}>Append</button>
      <ul>{items.map((item,index)=><li key={index} onClick={()=>{items[index]+='!';}}>{index}:{item}</li>)}</ul>
      <ol>{items.map((item,index)=><li key={item}>{index}:{item}</li>)}</ol></main>;}`));
  setScheduler(run=>run()); const specifier='./fixtures/out/positional-list/app.ts'; const {App}=await import(specifier);
  const root=App('App',null); document.body.append(root);
  const original=[...root.querySelectorAll('ul li')];
  root.querySelector('.reverse').click();
  expect([...root.querySelectorAll('ul li')].map((node:Element)=>node.textContent)).toEqual(['0:b','1:a']);
  expect([...root.querySelectorAll('ul li')]).toEqual(original);
  original[0]!.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  expect(original[0]!.textContent).toBe('0:b!');
  root.querySelector('.append').click();
  expect([...root.querySelectorAll('ul li')].map((node:Element)=>node.textContent)).toEqual(['0:b!','1:a','2:b']);
});

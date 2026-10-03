import { expect, it } from 'vitest';
import { createListRegion, type ListRegion } from '@memoized-dom/runtime';

it('preserves mutations, replacement bindings and indices in one updater', () => {
  const host = document.createElement('ul');
  const original = [{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}];
  const calls: string[] = [];
  const region = createListRegion(host, 'inline-sync', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item=initial, index=initialIndex;
    const bind = (next: unknown, position: number) => { item=next as typeof initial; index=position; };
    const render = () => { node.textContent=`${item.label}:${index}`; };
    render(); node.onclick=()=>{ node.title=item.label; };
    return {nodes:node,entities:[], update(next: unknown, position: number) {
      calls.push('update'); bind(next,position); render();
    }};
  }, item=>item.id, false, true);
  try {
    region.reconcile(original); const nodes=[...host.children] as HTMLElement[];
    original[0]!.label='mutated'; region.reconcile(original);
    expect(nodes[0]!.textContent).toBe('mutated:0');
    expect(calls).toEqual(['update','update','update']);
    const replacement={id:1,label:'replacement'};
    region.reconcile([original[2]!,replacement,original[1]!],true);
    expect([...host.children]).toEqual([nodes[2],nodes[0],nodes[1]]);
    expect(nodes.map(node=>node.textContent)).toEqual(['replacement:1','two:2','three:0']);
    nodes[0]!.click(); expect(nodes[0]!.title).toBe('replacement');
    replacement.label='targeted'; region.refreshKey(1);
    expect(nodes[0]!.textContent).toBe('targeted:1');
    original[1]!.label='indexed'; region.refreshIndices([original[2]!,replacement,original[1]!],[2],true);
    expect(nodes[1]!.textContent).toBe('indexed:2');
  } finally { region.dispose(); }
});

it('retains structural skipping and refreshes changed identities in fused entries', () => {
  const host=document.createElement('ul'); const items=[{id:1,label:'one'},{id:2,label:'two'}];
  const updates: string[]=[];
  const region=createListRegion(host,'inline-sync-structure',initial=>{
    const node=document.createElement('li'); node.textContent=initial.label;
    return {nodes:node,entities:[],update(next){const item=next as typeof initial;updates.push(item.label);node.textContent=item.label;}};
  },item=>item.id,false,false);
  try {
    region.reconcile(items); const nodes=[...host.children];
    region.reconcile([items[1]!,items[0]!],true);
    expect(updates).toEqual([]); expect([...host.children]).toEqual([nodes[1],nodes[0]]);
    region.reconcile([items[1]!,{id:1,label:'replacement'}],true);
    expect(updates).toEqual(['replacement']); expect(nodes[0]!.textContent).toBe('replacement');
  } finally {region.dispose();}
});

it.each(['reconcile','refreshKey','refreshIndices'])('stops after a fused updater unmounts during %s', operation => {
  const host=document.createElement('ul'); const updates:number[]=[]; const disposed:number[]=[];
  let region:ListRegion<number>;
  region=createListRegion(host,'inline-sync-unmount',item=>{
    const node=document.createElement('li');
    return {nodes:node,entities:[],update(next){updates.push(next as number);region.dispose();},dispose(){disposed.push(item);}};
  },item=>item,false);
  region.reconcile([1,2]);
  if(operation==='reconcile') region.reconcile([1,2,3]);
  else if(operation==='refreshKey') region.refreshKey(1);
  else region.refreshIndices([1,2],[0,1],true);
  expect(updates).toEqual([1]); expect(disposed).toEqual([1,2]);
  expect(host.childNodes).toHaveLength(0); expect(region.size()).toBe(0);
});

it('recovers retained order after an updater throws', () => {
  const host=document.createElement('ul'); const items=[{id:1,label:'one'},{id:2,label:'two'}];
  let fail=true;
  const region=createListRegion(host,'inline-sync-throw',initial=>{
    const node=document.createElement('li');node.textContent=initial.label;
    let item=initial;
    const render=()=>{if(fail){fail=false;throw new Error('row failed');}node.textContent=item.label;};
    return {nodes:node,entities:[],update(next:unknown){item=next as typeof initial;render();}};
  },item=>item.id,false,false);
  try {
    region.reconcile(items);const nodes=[...host.children];
    const next=[{id:2,label:'second'},{id:1,label:'first'}];
    expect(()=>region.reconcile(next)).toThrow('row failed');
    region.reconcile(next);
    expect([...host.children]).toEqual([nodes[1],nodes[0]]);
    expect(nodes.map(node=>node.textContent)).toEqual(['first','second']);
  } finally {region.dispose();}
});

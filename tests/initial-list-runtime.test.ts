import { afterEach, expect, it, vi } from 'vitest';
import { bindInitialList } from '../packages/runtime/src/initial-list';
import { createListRegion, createPositionalListRegion, type ListRegion } from '@memoized-dom/runtime/testing';

const regions:ListRegion<unknown>[]=[];
afterEach(()=>{for(const region of regions.splice(0))region.dispose();document.body.replaceChildren();});
function initial() {
  document.body.innerHTML='<ul><!--open--><li>one</li><li>two</li><!--end--></ul>';
  const parent=document.querySelector('ul')!;
  return {parent,open:parent.firstChild!,end:parent.lastChild!,rows:[...parent.querySelectorAll('li')]};
}
it('validates all initial row extents before any factory runs',()=>{
  const {parent,open,end,rows}=initial();const before=parent.innerHTML;
  expect(bindInitialList(parent,open,end,2).rows).toEqual(rows);
  for(const count of [0,1,3,-1,1.5,NaN,Infinity])expect(()=>bindInitialList(parent,open,end,count)).toThrow(/initial list/);
  expect(()=>bindInitialList(document.body,open,end,2)).toThrow(/anchors/);
  expect(()=>bindInitialList(parent,end,open,2)).toThrow(/row count/);
  expect(parent.innerHTML).toBe(before);
  parent.insertBefore(document.createTextNode('unexpected'),end);
  expect(()=>bindInitialList(parent,open,end,3)).toThrow(/host root/);
});

it.each([false,true])('shares ordinary row ownership after binding (positional=%s)',positional=>{
  const {parent,open,end,rows}=initial();const descriptor=bindInitialList(parent,open,end,2);
  const calls: number[]=[];
  function create(item:unknown,_id:string,index:number,root?:Node) {
    calls.push(arguments.length);
    const node=root??document.createElement('li');
    if(!root)node.textContent=String(item);
    return {nodes:node,entities:[],update(next:unknown){node.textContent=String(next);}};
  }
  const region=positional?createPositionalListRegion(parent,'Rows',create,descriptor)
    :createListRegion(parent,'Rows',create,(_item,index)=>index,false,true,true,descriptor);
  regions.push(region);
  const insert=vi.spyOn(parent,'insertBefore');region.reconcile(['one','two']);
  expect(insert).not.toHaveBeenCalled();expect(calls).toEqual([4,4]);
  expect([...parent.querySelectorAll('li')]).toEqual(rows);
  region.reconcile(['changed','two','three']);expect(calls).toEqual([4,4,3]);
  expect(parent.querySelector('li')).toBe(rows[0]);expect(rows[0]!.textContent).toBe('changed');
  region.dispose();expect(parent.childNodes).toHaveLength(0);expect(region.size()).toBe(0);insert.mockRestore();
});

it.each([false,true])('rejects mismatched client row count before creation (positional=%s)',positional=>{
  const {parent,open,end}=initial();const descriptor=bindInitialList(parent,open,end,2);
  const create=vi.fn((_item:unknown,_id:string,_index:number,root?:Node)=>({nodes:root!,entities:[]}));
  const region=positional?createPositionalListRegion(parent,'Rows',create,descriptor)
    :createListRegion(parent,'Rows',create,(_item,index)=>index,false,true,true,descriptor);
  regions.push(region);const before=parent.innerHTML;
  expect(()=>region.reconcile(['one'])).toThrow(/client state/);expect(create).not.toHaveBeenCalled();
  expect(parent.innerHTML).toBe(before);region.reconcile(['one','two']);expect(create).toHaveBeenCalledTimes(2);
});

it.each([false,true])('cleans unbound initial rows on disposal and interrupted construction (positional=%s)',positional=>{
  for(const phase of ['before','during','failed'] as const) {
    const {parent,open,end}=initial();const descriptor=bindInitialList(parent,open,end,2);
    let region:ListRegion<unknown>;let fail=true;
    const create=(_item:unknown,_id:string,index:number,root?:Node)=>{
      if(phase==='during')region.dispose();
      if(phase==='failed'&&index===1&&fail)throw undefined;
      return {nodes:root!,entities:[]};
    };
    region=positional?createPositionalListRegion(parent,'Rows',create,descriptor)
      :createListRegion(parent,'Rows',create,(_item,index)=>index,false,true,true,descriptor);
    if(phase==='before')region.dispose();
    else if(phase==='during')region.reconcile(['one','two']);
    else {
      let caught=false;
      try {region.reconcile(['one','two']);}catch(error){caught=true;expect(error).toBeUndefined();}
      expect(caught).toBe(true);fail=false;region.reconcile(['one','two']);expect(region.size()).toBe(2);region.dispose();
    }
    expect(parent.childNodes).toHaveLength(0);region.dispose();
  }
});

it.each([false,true])('aggregates initial release and both anchor failures in order (positional=%s)',positional=>{
  const {parent,open,end}=initial();const descriptor=bindInitialList(parent,open,end,2);
  const releaseError=new Error('initial release'),endError=new Error('end anchor'),openError=new Error('open anchor');
  let released=0;
  const initialDOM={...descriptor,dispose(){released++;descriptor.dispose();throw releaseError;}};
  const create=vi.fn(()=>({nodes:document.createElement('li'),entities:[]}));
  const region=positional?createPositionalListRegion(parent,'Rows',create,initialDOM)
    :createListRegion(parent,'Rows',create,(_item,index)=>index,false,true,true,initialDOM);
  const remove=parent.removeChild.bind(parent);
  const spy=vi.spyOn(parent,'removeChild').mockImplementation(node=>{
    const result=remove(node);if(node===end)throw endError;if(node===open)throw openError;return result;
  });
  try {
    let failure:unknown;try{region.dispose();}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([releaseError,endError,openError]);
    expect(parent.childNodes).toHaveLength(0);expect(create).not.toHaveBeenCalled();
    region.dispose();expect(released).toBe(1);
  } finally {spy.mockRestore();}
});

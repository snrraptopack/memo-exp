import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createApplicationRuntime, getActiveApplicationRuntime, register,
  setActiveApplicationRuntime, setScheduler, unregister, type ApplicationRuntime,
} from '../packages/runtime/src/kernel';

let previous:ApplicationRuntime, runtime:ApplicationRuntime;
const frames:Array<()=>void>=[];
beforeEach(()=>{
  frames.length=0;previous=getActiveApplicationRuntime();
  runtime=createApplicationRuntime('volatile-recovery',{document,schedule:run=>{frames.push(run);}});
  setActiveApplicationRuntime(runtime);setScheduler(run=>run());
});
afterEach(()=>{runtime.dispose();setActiveApplicationRuntime(previous);frames.length=0;});

it('keeps one future frame and a full retry after a synchronous pull throws',()=>{
  let fail=true;
  const error=new Error('pull failed');
  const render=vi.fn((_reasons?:unknown)=>{if(fail)throw error;});
  register({id:'Owner',parent:null,volatile:true,render});
  expect(frames).toHaveLength(1);
  expect(()=>frames.shift()!()).toThrow(error);
  expect(render).toHaveBeenCalledTimes(1);expect(frames).toHaveLength(1);
  fail=false;frames.shift()!();
  expect(render.mock.calls.map(call=>call[0])).toEqual([-1,null]);
  expect(frames).toHaveLength(1);
  unregister('Owner');frames.shift()!();
  expect(frames).toHaveLength(0);expect(render).toHaveBeenCalledTimes(2);
});

it.each(['unregister','dispose'] as const)('does not rearm when a failed pull removes its owner through %s',kind=>{
  const render=vi.fn(()=>{
    if(kind==='unregister')unregister('Owner');else runtime.dispose();
    throw new Error('removed');
  });
  register({id:'Owner',parent:null,volatile:true,render});
  expect(()=>frames.shift()!()).toThrow('removed');
  expect(frames).toHaveLength(0);expect(render).toHaveBeenCalledTimes(1);
});

import { expect, it } from 'vitest';
import { register } from '../packages/runtime/src/volatile';
import {
  createApplicationRuntime, runWithApplicationRuntime, registerEntity, setScheduler,
  unregisterSubtree, _internals,
} from '../packages/runtime/src/kernel';

it('keeps pull state scoped to runtimes that use it, even after the feature has been installed',()=>{
  const frames:Array<()=>void>=[];
  const polling=createApplicationRuntime('polling',{document,schedule:run=>frames.push(run)});
  const ordinary=createApplicationRuntime('ordinary',{document,schedule:run=>frames.push(run)});
  let renders=0;
  try {
    runWithApplicationRuntime(polling,()=>{
      setScheduler(run=>run());register({id:'Pull',parent:null,volatile:true,render(){renders++;}});
    });
    runWithApplicationRuntime(ordinary,()=>{
      registerEntity({id:'Plain',parent:null,render(){}});
      expect(_internals().volatileSet.size).toBe(0);
      expect(ordinary.state.extensions.has('mmd:volatile')).toBe(false);
      unregisterSubtree('Plain');
      expect(ordinary.state.extensions.has('mmd:volatile')).toBe(false);
    });
    expect(frames).toHaveLength(1);frames.shift()!();expect(renders).toBe(1);
    polling.dispose();
    expect(frames).toHaveLength(1);frames.shift()!();
    expect(renders).toBe(1);expect(frames).toHaveLength(0);
  } finally {polling.dispose();ordinary.dispose();}
});

it('seeds earlier registration, cancels pull on replacement and keeps other runtime frames independent',()=>{
  const framesA:Array<()=>void>=[],framesB:Array<()=>void>=[];
  const a=createApplicationRuntime('a',{document,schedule:run=>framesA.push(run)});
  const b=createApplicationRuntime('b',{document,schedule:run=>framesB.push(run)});
  const renders:string[]=[];
  try {
    for(const runtime of [a,b])runWithApplicationRuntime(runtime,()=>{
      setScheduler(run=>run());
      registerEntity({id:'Pull',parent:null,volatile:true,render(){renders.push(runtime.id);}});
      register({id:'Owner',parent:null,render(){}});
    });
    expect(framesA).toHaveLength(1);expect(framesB).toHaveLength(1);
    runWithApplicationRuntime(a,()=>{
      registerEntity({id:'Pull',parent:null,render(){renders.push('replacement');}});
      expect(_internals().volatileSet.size).toBe(0);
    });
    framesA.shift()!();expect(framesA).toHaveLength(0);
    framesB.shift()!();expect(renders).toEqual(['b']);expect(framesB).toHaveLength(1);
    b.dispose();framesB.shift()!();expect(framesB).toHaveLength(0);
  } finally {a.dispose();b.dispose();}
});

it('keeps pull recovery after a failed render and stops queued frames when the runtime is disposed',()=>{
  const frames:Array<()=>void>=[];
  const runtime=createApplicationRuntime('recovery',{document,schedule:run=>frames.push(run)});
  let fail=true,renders=0;
  try {
    runWithApplicationRuntime(runtime,()=>{
      setScheduler(run=>run());
      register({id:'Pull',parent:null,volatile:true,render(){
        if(fail)throw new Error('render failed');renders++;
      }});
    });
    expect(()=>frames.shift()!()).toThrow('render failed');expect(frames).toHaveLength(1);
    fail=false;frames.shift()!();expect(renders).toBe(1);expect(frames).toHaveLength(1);
    runtime.dispose();frames.shift()!();expect(renders).toBe(1);expect(frames).toHaveLength(0);
  } finally {runtime.dispose();}
});

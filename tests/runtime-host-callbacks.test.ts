import { afterEach, beforeEach, expect, it, vi } from 'bun:test';
import {
  createApplicationRuntime, getActiveApplicationRuntime, markDirty, register,
  runWithApplicationRuntime, setActiveApplicationRuntime, setScheduler,
  type ApplicationRuntime,
} from '../packages/runtime/src/kernel';

let previous: ApplicationRuntime;
const runtimes: ApplicationRuntime[] = [];
beforeEach(() => { previous = getActiveApplicationRuntime(); });
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  setActiveApplicationRuntime(previous);
});

function isolated(id: string, frames: Array<() => void> = []) {
  const runtime = createApplicationRuntime(id, {document, schedule: run => { frames.push(run); }});
  runtimes.push(runtime);
  return runtime;
}

it('runs a queued commit in its originating runtime and restores the ambient owner', () => {
  const a = isolated('a'), b = isolated('b');
  const queued: Array<() => void> = [];
  const renders: string[] = [];
  runWithApplicationRuntime(a, () => {
    setScheduler(run => { queued.push(run); });
    register({id:'App',parent:null,render() {renders.push(getActiveApplicationRuntime().id);}});
    markDirty('App');
  });
  runWithApplicationRuntime(b, () => {
    register({id:'App',parent:null,render() {renders.push('wrong owner');}});
  });
  setActiveApplicationRuntime(b);
  queued.shift()!();
  expect(renders).toEqual(['a']);
  expect(getActiveApplicationRuntime()).toBe(b);
  expect(a.state.dirty.size).toBe(0);
});

it('keeps the write destination when a reason getter changes the ambient runtime', () => {
  const a = isolated('write-a'), b = isolated('write-b');
  const queued: Array<() => void> = [];
  const render = vi.fn(() => expect(getActiveApplicationRuntime()).toBe(a));
  runWithApplicationRuntime(a, () => {
    setScheduler(run => { queued.push(run); });
    register({id:'App',parent:null,render});
  });
  setActiveApplicationRuntime(a);
  const reasons=[1];
  Object.defineProperty(reasons,0,{get(){setActiveApplicationRuntime(b);return 1;}});
  markDirty('App',reasons);
  queued.shift()!();
  expect(render).toHaveBeenCalledTimes(1);
  expect(a.state.dirty.size).toBe(0);
  expect(getActiveApplicationRuntime()).toBe(b);
});

it('runs a delayed opaque pull in its originating runtime and stops after disposal', () => {
  const frames: Array<() => void> = [];
  const a = isolated('pull-a', frames), b = isolated('pull-b');
  const render = vi.fn(() => expect(getActiveApplicationRuntime()).toBe(a));
  runWithApplicationRuntime(a, () => {
    setScheduler(run => run());
    register({id:'App',parent:null,volatile:true,render});
  });
  runWithApplicationRuntime(b, () => {
    setScheduler(run => run());
    register({id:'App',parent:null,render() {throw new Error('wrong owner');}});
  });
  setActiveApplicationRuntime(b);
  frames.shift()!();
  expect(render).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(1);
  expect(getActiveApplicationRuntime()).toBe(b);
  a.dispose();
  frames.shift()!();
  expect(render).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(0);
});

it.each([true,false])('reads volatility once after registration (volatile=%s)', volatile => {
  const frames: Array<() => void> = [];
  const runtime = isolated('getter-order',frames);
  let reads = 0;
  runWithApplicationRuntime(runtime, () => {
    register({id:'App',parent:null,render(){},get volatile() {
      reads++;
      expect(runtime.state.registry.has('App')).toBe(true);
      return volatile;
    }});
  });
  expect(reads).toBe(1);
  expect(frames).toHaveLength(volatile?1:0);
});

it('keeps pull scheduling on the registration owner when a volatility getter changes the ambient runtime',()=>{
  const framesA:Array<()=>void>=[],framesB:Array<()=>void>=[];
  const a=isolated('getter-a',framesA),b=isolated('getter-b',framesB);
  const render=vi.fn(()=>expect(getActiveApplicationRuntime()).toBe(a));
  let reads=0;
  runWithApplicationRuntime(a,()=>{
    setScheduler(run=>run());
    register({id:'App',parent:null,render,get volatile(){
      reads++;setActiveApplicationRuntime(b);return true;
    }});
  });
  expect(reads).toBe(1);expect(framesA).toHaveLength(1);expect(framesB).toHaveLength(0);
  framesA.shift()!();expect(render).toHaveBeenCalledTimes(1);
});

it('does not let a disposed runtime\'s queued commit drain another runtime', () => {
  const a = isolated('disposed-a'), b = isolated('live-b');
  const queuedA: Array<() => void> = [], queuedB: Array<() => void> = [];
  const render = vi.fn();
  runWithApplicationRuntime(a, () => {
    setScheduler(run => { queuedA.push(run); });
    register({id:'App',parent:null,render});
    markDirty('App');
  });
  runWithApplicationRuntime(b, () => {
    setScheduler(run => { queuedB.push(run); });
    register({id:'App',parent:null,render});
    markDirty('App');
  });
  a.dispose();
  setActiveApplicationRuntime(b);
  queuedA.shift()!();
  expect(render).not.toHaveBeenCalled();
  expect(b.state.dirty.has('App')).toBe(true);
  queuedB.shift()!();
  expect(render).toHaveBeenCalledTimes(1);
});

it('restores the ambient runtime after a queued render fails and retries a later write', () => {
  const a = isolated('error-a'), b = isolated('error-b');
  const queued: Array<() => void> = [];
  const failure = new Error('render failed');
  let fail = true;
  const render = vi.fn(() => {expect(getActiveApplicationRuntime()).toBe(a);if (fail) throw failure;});
  runWithApplicationRuntime(a, () => {
    setScheduler(run => { queued.push(run); });
    register({id:'App',parent:null,render});
    markDirty('App',1);
  });
  setActiveApplicationRuntime(b);
  expect(() => queued.shift()!()).toThrow(failure);
  expect(getActiveApplicationRuntime()).toBe(b);
  fail = false;
  runWithApplicationRuntime(a, () => markDirty('App',2));
  queued.shift()!();
  expect(render).toHaveBeenCalledTimes(2);
  expect(a.state.dirty.size).toBe(0);
  expect(getActiveApplicationRuntime()).toBe(b);
});

import { afterEach, beforeEach, expect, it } from 'bun:test';
import {
  createApplicationRuntime, getActiveApplicationRuntime, has, markDirty, onEntityDispose,
  onRegistryChange, register, registeredIds, registryGeneration, setActiveApplicationRuntime,
  setScheduler, unregister, type ApplicationRuntime,
  _internals,
} from '../packages/runtime/src/kernel';
import { cleanup } from '../packages/runtime/src/cleanup';

let previous: ApplicationRuntime, runtime: ApplicationRuntime;
let notification: ((id: string) => void) | undefined;
let disposeHook: ((id: string) => readonly unknown[] | void) | undefined;
onRegistryChange((id, kind) => { if (kind === 'remove') notification?.(id); });
onEntityDispose(id => disposeHook?.(id));
beforeEach(() => {
  previous = getActiveApplicationRuntime();
  runtime = createApplicationRuntime('leaf-teardown-test', { schedule: null });
  setActiveApplicationRuntime(runtime);
});
afterEach(() => {
  notification = undefined; disposeHook = undefined;
  runtime.dispose(); setActiveApplicationRuntime(previous);
});

it.each([false, true])('cleanup sees the current registry and generation (subtree=%s)', subtree => {
  register({id:'Keep',parent:null,render(){}});
  register({id:'Owner',parent:null,render(){}});
  if (subtree) register({id:'Owner/Child',parent:'Owner',render(){}});
  const snapshot = registeredIds();
  const generation = registryGeneration();
  const observations: string[][] = [], generations: number[] = [];
  cleanup('Owner', () => {
    observations.push([...registeredIds()]); generations.push(registryGeneration());
    expect(has('Owner')).toBe(false); expect(has('Owner/Child')).toBe(false);
  });
  unregister('Owner');
  expect(observations).toEqual([['Keep']]); expect(generations[0]).toBeGreaterThan(generation);
  expect([...snapshot]).toEqual(subtree ? ['Keep','Owner','Owner/Child'] : ['Keep','Owner']);
});

it('registry notifications see each removal even when they repopulate the ID cache', () => {
  register({id:'Owner',parent:null,render(){}});
  register({id:'Owner/A',parent:'Owner',render(){}});
  register({id:'Owner/B',parent:'Owner',render(){}});
  registeredIds();
  const snapshots: string[][] = [];
  notification = () => snapshots.push([...registeredIds()]);
  unregister('Owner');
  expect(snapshots).toEqual([['Owner','Owner/B'], ['Owner'], []]);
});

it('keeps descendant-first disposal and LIFO cleanups without stopping on errors', () => {
  const calls: string[] = [], first = new Error('first'), second = new Error('second');
  for (const [id,parent] of [['Root',null], ['Root/A','Root'], ['Root/B','Root'], ['Root/A/Grand','Root/A']] as const) {
    register({id,parent,render(){}}); cleanup(id, () => { calls.push(id); });
  }
  cleanup('Root/A/Grand', () => { calls.push('grand-error'); throw first; });
  cleanup('Root', () => { calls.push('root-error'); throw second; });
  let thrown: unknown;
  try { unregister('Root'); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(AggregateError);
  expect((thrown as AggregateError).errors).toEqual([first,second]);
  expect(calls).toEqual(['grand-error','Root/A/Grand','Root/A','Root/B','root-error','Root']);
  expect(registeredIds()).toEqual([]);
});

it('a leaf cleanup cancels pending and volatile state and allows a replacement owner', () => {
  const pending: Array<() => void> = [], renders: string[] = [];
  setScheduler(run => pending.push(run));
  register({id:'Parent',parent:null,render(){}});
  register({id:'Parent/Leaf',parent:'Parent',volatile:true,render(){renders.push('old');}});
  markDirty('Parent/Leaf', 'old');
  cleanup('Parent/Leaf', () => {
    expect(runtime.state.dirty.has('Parent/Leaf')).toBe(false);
    expect(_internals().volatileSet.has('Parent/Leaf')).toBe(false);
    expect(runtime.state.dirtyReasons.has('Parent/Leaf')).toBe(false);
    markDirty('Parent/Leaf');
    register({id:'Parent/Leaf',parent:'Parent',render(){renders.push('new');}});
    markDirty('Parent/Leaf');
  });
  unregister('Parent/Leaf');
  while (pending.length) pending.shift()!();
  expect(renders).toEqual(['new']);
  expect(runtime.state.registry.get('Parent')!.children!.has('Parent/Leaf')).toBe(true);
});

it.each([false, true])('preserves authored child-link getter evaluation (has child=%s)', nested => {
  let reads = 0;
  register({id:'Child',parent:null,render(){}});
  register({id:'Root',parent:null,render(){},get children() {
    reads++; return nested ? new Set(['Child']) : undefined;
  }});
  unregister('Root');
  expect(reads).toBe(nested ? 2 : 1); expect(has('Child')).toBe(!nested);
});

it('consumes disposal-hook iterators and reports a single yielded error unchanged', () => {
  const error = new Error('hook'), calls: string[] = [];
  register({id:'Leaf',parent:null,render(){}});
  cleanup('Leaf', () => { calls.push('cleanup'); });
  disposeHook = id => {
    if (id !== 'Leaf') return;
    const errors: unknown[] = [];
    errors[Symbol.iterator] = function* () { calls.push('iterator'); yield error; };
    return errors;
  };
  expect(() => unregister('Leaf')).toThrow(error);
  expect(calls).toEqual(['iterator','cleanup']); expect(has('Leaf')).toBe(false);
});

import { expectCalledOnceWith } from '../test-support/helpers';
import { afterEach, beforeEach, expect, it, vi } from 'bun:test';
import {
  _internals, commit, markDirty, register, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

beforeEach(() => setScheduler(run => run()));
afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  resetScheduler();
});

it('retains a full retry after a partial render fails and drains it with later work', () => {
  const failure = new Error('render failed');
  let fail = true;
  const render = vi.fn((_reasons?: unknown) => { if (fail) throw failure; });
  const peer = vi.fn();
  register({ id: 'owner', parent: null, render });
  register({ id: 'peer', parent: null, render: peer });
  expect(() => markDirty('owner', 0)).toThrow(failure);
  expect(_internals().dirtySet.has('owner')).toBe(true);
  fail = false;
  markDirty('peer', 1);
  expect(render.mock.calls.map(call => call[0])).toEqual([0, null]);
  expect(peer).toHaveBeenCalledWith(1);
  expect(_internals().dirtySet.size).toBe(0);
});

it.each([false, true])('does not revive an entity removed during a failed render (replace=%s)', replace => {
  const replacement = vi.fn();
  register({ id: 'owner', parent: null, render() {
    unregister('owner');
    if (replace) register({ id: 'owner', parent: null, render: replacement });
    throw new Error('removed');
  } });
  expect(() => markDirty('owner', 0)).toThrow('removed');
  expect(_internals().dirtySet.has('owner')).toBe(false);
  expect(_internals().registry.has('owner')).toBe(replace);
  expect(replacement).not.toHaveBeenCalled();
});

it('does not automatically retry a failed effect with later unrelated work', () => {
  const effect = vi.fn(() => { throw new Error('effect failed'); });
  register({ id: 'effect', parent: null, phase: 'effect', render: effect });
  register({ id: 'peer', parent: null, render() {} });
  expect(() => markDirty('effect', 0)).toThrow('effect failed');
  expect(_internals().dirtySet.has('effect')).toBe(false);
  markDirty('peer', 1);
  expect(effect).toHaveBeenCalledTimes(1);
});

it('settles siblings and their cascades after a render fails, deferring effects and failed descendants', () => {
  setScheduler(() => {});
  const failure = new Error('bad branch'), calls: string[] = [];
  let fail = true;
  register({id:'root',parent:null,render() {}});
  register({id:'bad',parent:'root',render() { calls.push('bad'); if (fail) throw failure; }});
  register({id:'child',parent:'bad',render() { calls.push('child'); }});
  register({id:'sibling',parent:'root',render() { calls.push('sibling'); markDirty('cascade', 3); }});
  register({id:'cascade',parent:'sibling',render(reasons) { calls.push(`cascade:${reasons}`); }});
  register({id:'effect',parent:'root',phase:'effect',render() { calls.push('effect'); }});
  for (const id of ['bad','child','sibling','effect']) markDirty(id, 1);
  expect(() => commit()).toThrow(failure);
  expect(calls).toEqual(['bad','sibling','cascade:3']);
  expect([..._internals().dirtySet]).toEqual(['child','effect','bad']);
  fail = false; commit();
  expect(calls).toEqual(['bad','sibling','cascade:3','bad','child','effect']);
  expect(_internals().dirtySet.size).toBe(0);
});

it('reports independent failures together without repeatedly retrying either render', () => {
  setScheduler(() => {});
  const first = new Error('first'), second = new Error('second'), calls: string[] = [];
  for (const [id,error] of [['a',first],['b',second]] as const) register({id,parent:null,render() {calls.push(id); throw error;}});
  register({id:'peer',parent:null,render() {calls.push('peer');}});
  for (const id of ['a','b','peer']) markDirty(id);
  let error: unknown; try {commit();} catch (caught) {error=caught;}
  expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([first,second]);
  expect(calls).toEqual(['a','b','peer']); expect([..._internals().dirtySet]).toEqual(['a','b']);
});

it('does not render a stale batch entry after a peer replaces its entity', () => {
  setScheduler(() => {}); const stale = vi.fn(), replacement = vi.fn();
  register({id:'owner',parent:null,render() {
    unregister('peer'); register({id:'peer',parent:null,render:replacement}); markDirty('peer', 2);
  }});
  register({id:'peer',parent:null,render:stale});
  markDirty('owner'); markDirty('peer', 1); commit();
  expect(stale).not.toHaveBeenCalled(); expectCalledOnceWith((replacement), 2);
});

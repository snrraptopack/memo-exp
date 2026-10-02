import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  _internals, markDirty, register, resetScheduler, setScheduler, unregister,
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

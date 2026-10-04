import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createApplicationRuntime, getActiveApplicationRuntime, invalidateEntity,
  markDirty, registerEntity, runWithApplicationRuntime, setActiveApplicationRuntime,
  setScheduler, type ApplicationRuntime, type DirtyReasons,
} from '../packages/runtime/src/kernel';

let previous: ApplicationRuntime;
let runtime: ApplicationRuntime;
const queued: Array<() => void> = [];
const reasons: Array<DirtyReasons | undefined> = [];
beforeEach(() => {
  previous = getActiveApplicationRuntime();
  runtime = createApplicationRuntime('full-owner', { document, schedule: null });
  setActiveApplicationRuntime(runtime);
  setScheduler(run => { queued.push(run); });
  registerEntity({ id: 'App', parent: null, render(reason) { reasons.push(reason); } });
});
afterEach(() => {
  runtime.dispose();
  setActiveApplicationRuntime(previous);
  queued.length = 0;
  reasons.length = 0;
});

it('batches full owner updates without an exact cause', () => {
  invalidateEntity('App');
  invalidateEntity('App');
  expect(queued).toHaveLength(1);
  queued.shift()!();
  expect(reasons).toEqual([null]);
});

it('lets a full owner update dominate exact causes before and after it', () => {
  markDirty('App', 1);
  markDirty('App', 2);
  invalidateEntity('App');
  markDirty('App', 3);
  queued.shift()!();
  expect(reasons).toEqual([null]);
  expect(runtime.state.dirtyReasons.size).toBe(0);
  invalidateEntity('App');
  markDirty('App', [4, 5]);
  queued.shift()!();
  expect(reasons).toEqual([null, null]);
});

it('preserves exact merging after a full commit and ignores dead owners', () => {
  invalidateEntity('Missing');
  expect(queued).toHaveLength(0);
  invalidateEntity('App');
  queued.shift()!();
  markDirty('App', 1);
  markDirty('App', [2, 3]);
  queued.shift()!();
  expect(reasons[1]).toEqual(new Set([1, 2, 3]));
  expect(runtime.state.dirtyReasons.size).toBe(0);
});

it('runs queued full updates in their owner after another runtime becomes active', () => {
  const other = createApplicationRuntime('other', { document, schedule: null });
  try {
    runWithApplicationRuntime(other, () => registerEntity({ id: 'App', parent: null, render() { throw new Error('wrong owner'); } }));
    invalidateEntity('App');
    setActiveApplicationRuntime(other);
    queued.shift()!();
    expect(reasons).toEqual([null]);
    expect(getActiveApplicationRuntime()).toBe(other);
  } finally { other.dispose(); }
});

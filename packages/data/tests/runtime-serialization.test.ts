import { describe, expect, it, vi } from 'vitest';
import { createCoreDataRuntime } from '../src/runtime-core';
import { enableDataReads } from '../src/read-resource';
import { exposeDataRuntime } from '../src/client';
import { getActiveDataRuntime, runWithDataRuntime } from '../src';

describe('optional data transfer producer', () => {
  it('exposes serialization on the same store after requests and reads already exist', async () => {
    const fetcher = vi.fn(async () => Response.json({name:'Ada'}));
    const core = createCoreDataRuntime({fetch:fetcher});
    const fetched = core.$fetch('/user');
    const reads = enableDataReads(core);
    const read = reads.$read(Promise.resolve('ready'));
    expect(reads).toBe(core);
    expect('serializeState' in reads).toBe(false);
    await expect(core.settle()).resolves.toBe(true);
    const runtime = exposeDataRuntime(core);
    try {
      expect(runtime).toBe(core);
      expect(exposeDataRuntime(core)).toBe(runtime);
      expect(runWithDataRuntime(runtime, () => getActiveDataRuntime())).toBe(runtime);
      expect(runtime.serializeState().sources).toHaveLength(1);
      expect(runtime.serializeState().sources[0]!.snapshot).toEqual({
        status:'success',data:{name:'Ada'},revalidate:false,
      });
      expect(fetched.data).toEqual({name:'Ada'});
      expect(read.data).toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const restoredFetch = vi.fn(async () => Response.json({name:'wrong'}));
      const restored = createCoreDataRuntime({fetch:restoredFetch});
      try {
        restored.restoreState(runtime.serializeState());
        expect(restored.$fetch('/user').data).toEqual({name:'Ada'});
        expect(restoredFetch).not.toHaveBeenCalled();
      } finally { restored.clear(); }
      runtime.clear();
      expect(runtime.serializeState()).toEqual({formatVersion:1,sources:[]});
    } finally { runtime.clear(); }
  });

  it('keeps serialization safety checks and excludes rich data without invoking getters', async () => {
    const runtime = exposeDataRuntime(createCoreDataRuntime({fetch:async () => Response.json({ok:true})}));
    const resource = runtime.$fetch<Record<string,unknown>>('/user');
    try {
      await runtime.settle();
      const getter = vi.fn(() => 'private');
      resource.update(() => Object.defineProperty({}, 'secret', {get:getter,enumerable:true}));
      expect(runtime.serializeState().sources).toEqual([]);
      expect(getter).not.toHaveBeenCalled();
      resource.update(() => ({date:new Date()}));
      expect(runtime.serializeState().sources).toEqual([]);
      const cycle: Record<string,unknown> = {};
      cycle.self = cycle;
      resource.update(() => cycle);
      expect(runtime.serializeState().sources).toEqual([]);
    } finally { runtime.clear(); }
  });
});

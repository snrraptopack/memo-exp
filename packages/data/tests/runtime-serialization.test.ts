import { describe, expect, it, vi } from 'vitest';
import { createCoreDataRuntime } from '../src/runtime-core';
import { enableDataReads } from '../src/read-resource';
import { exposeDataRuntime } from '../src/client';
import { enableDataSerialization } from '../src/serialization';
import { enableDataRestoration } from '../src/restoration';
import { getActiveDataRuntime, runWithDataRuntime } from '../src';

describe('optional data transfer producer', () => {
  it('does not fingerprint validators for client requests without transfer support', async () => {
    const validate = (value: unknown) => ({value});
    const fingerprint = vi.fn(() => { throw new Error('client must not fingerprint'); });
    validate.toString = fingerprint;
    const runtime = createCoreDataRuntime({fetch: async () => Response.json('ready')});
    try {
      const source = runtime.$fetch('/user', {validate: {
        '~standard': {version: 1, vendor: 'test', validate},
      }});
      await runtime.settle();
      expect(source.data).toBe('ready');
      expect(fingerprint).not.toHaveBeenCalled();
    } finally {runtime.clear();}
  });

  it('transfers earlier URL requests through serialization-only installation', async () => {
    const runtime = createCoreDataRuntime({fetch: async () => Response.json({id: 7})});
    const target = new URL('https://app.test/_fn/stories/story?id=7');
    const source = runtime.$fetch(target);
    try {
      await runtime.settle();
      target.pathname = '/_fn/changed';
      target.search = '?id=99';
      const producer = enableDataSerialization(runtime);
      expect(producer).toBe(runtime);
      const state = producer.serializeState();
      expect(state.sources).toHaveLength(1);
      expect(state.sources[0]!.snapshot).toEqual({status:'success',data:{id:7},revalidate:false});
      expect(source.data).toEqual({id:7});
      const fetcher = vi.fn(async () => Response.json({id:99}));
      const consumer = enableDataRestoration(createCoreDataRuntime({fetch: fetcher}));
      try {
        consumer.restoreState(state);
        expect(consumer.$fetch(new URL('https://app.test/_fn/stories/story?id=7')).data).toEqual({id:7});
        expect(fetcher).not.toHaveBeenCalled();
      } finally {consumer.clear();}
    } finally {runtime.clear();}
  });

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
      fetched.update(() => ({name:'Grace'}));
      expect(fetched.data).toEqual({name:'Grace'});
      fetched.mutate(value => { (value as {name:string}).name = 'Ada'; });
      expect(read.data).toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const restoredFetch = vi.fn(async () => Response.json({name:'wrong'}));
      const restored = exposeDataRuntime(createCoreDataRuntime({fetch:restoredFetch}));
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

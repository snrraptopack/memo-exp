import { expect, it, vi } from 'vitest';
import { createCoreDataRuntime } from '../src/runtime-core';
import { createDataRuntime, exposeDataRuntime } from '../src/client';
import { $fetch } from '../src/index';
import { runWithDataRuntime } from '../src/active-runtime';
import { createBodylessSource, createSource } from '../src/transparent-module';
import { rebindFetchResource } from '../src/resource';
import type { FetchResource } from '../src/types';

it('adds body encoding to the same runtime after a compiled GET already exists', async () => {
  const requests: RequestInit[] = [];
  const core = createCoreDataRuntime({fetch:async (_input, init) => {
    requests.push(init!);
    return Response.json({ok:true});
  }});
  try {
    const get = runWithDataRuntime(core, () => createBodylessSource('/user'));
    expect(await core.settle()).toBe(true);
    const runtime = exposeDataRuntime(core);
    expect(runtime).toBe(core);
    const post = runtime.$fetch('/action',{method:'POST',body:{name:'Ada'}});
    expect(await core.settle()).toBe(true);
    expect(requests[0]!.body).toBeUndefined();
    expect(requests[1]!.body).toBe('{"name":"Ada"}');
    expect(new Headers(requests[1]!.headers).get('content-type')).toBe('application/json');
    expect(get).not.toBe(post);
  } finally {core.clear();}
});

it('keeps generic facades and request replay able to encode changed bodies', async () => {
  const requests: RequestInit[] = [];
  const core = createCoreDataRuntime({fetch:async (_input, init) => {
    requests.push(init!);return Response.json({ok:true});
  }});
  try {
    const source = runWithDataRuntime(core, () => createSource('/action',{method:'POST',body:{id:1}}));
    await core.settle();
    rebindFetchResource(source as unknown as FetchResource<{ok:boolean}>,'/action',{method:'POST',body:{id:2}});
    await core.settle();
    runWithDataRuntime(core, () => $fetch('/other',{method:'POST',body:'plain'}));
    await core.settle();
    expect(requests.map(request => request.body)).toEqual(['{"id":1}','{"id":2}','plain']);
  } finally {core.clear();}
});

it('does not evaluate a paused body and preserves GET body rejection', () => {
  const fetcher = vi.fn(async () => Response.json({ok:true}));
  const core = createCoreDataRuntime({fetch:fetcher});
  const body = vi.fn(() => 'payload');
  try {
    runWithDataRuntime(core, () => createBodylessSource(null,{get body(){return body();}}));
    expect(body).not.toHaveBeenCalled();
    expect(() => runWithDataRuntime(core, () => createBodylessSource('/user',{body:'payload'}))).toThrow('GET requests cannot include a body');
    expect(fetcher).not.toHaveBeenCalled();
  } finally {core.clear();}
});

it('delegates through a foreign runtime facade without requiring its private fetch store', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ok:true}));
  const owner = createDataRuntime({fetch:fetcher});
  const foreign = {...owner};
  try {
    runWithDataRuntime(foreign, () => $fetch('/action',{method:'POST',body:{id:1}}));
    expect(await owner.settle()).toBe(true);
    expect(fetcher.mock.calls[0]![1]!.body).toBe('{"id":1}');
  } finally {owner.clear();}
});

import {expect,it,vi} from 'bun:test';
import {createDataRuntime} from '../src/client';
import {rebindFetchResource} from '../src/resource';
import type {FetchOptions} from '../src/types';

it('preserves paused requests without reading query or body inputs',()=>{
  const fetcher=vi.fn();const runtime=createDataRuntime({fetch:fetcher});
  const options:FetchOptions={get query():never{throw new Error('query was read');},get body():never{throw new Error('body was read');}};
  try {
    const source=runtime.$fetch(null,options);
    rebindFetchResource(source,null,options);
    expect(source.status).toBe('idle');expect(fetcher).not.toHaveBeenCalled();
  } finally {runtime.clear();}
});

it('normalizes equivalent headers and detects changed requests sharing an explicit key',async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true}));
  const runtime=createDataRuntime({fetch:fetcher,baseURL:'https://app.test'});
  try {
    const source=runtime.$fetch('/one',{key:'shared',headers:{'X-Value':'a & b',Authorization:'first'}});
    expect(await runtime.settle()).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
    rebindFetchResource(source,'/one',{key:'shared',headers:{authorization:'first','x-value':'a & b'}});
    expect(await runtime.settle()).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
    rebindFetchResource(source,'/one',{key:'shared',headers:{authorization:'second','x-value':'a & b'}});
    expect(await runtime.settle()).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
    rebindFetchResource(source,'/two',{key:'shared',headers:{authorization:'second','x-value':'a & b'}});
    expect(await runtime.settle()).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {runtime.clear();}
});

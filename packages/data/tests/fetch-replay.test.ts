import { waitFor, type FetchStub } from '../../../test-support/helpers';
import { expect, it } from 'bun:test';
import {createDataRuntime} from '../src/client';
import {fetchResourceOperationId,rebindFetchResourceFrom} from '../src/resource';

function pendingFetch() {
  const requests:Array<{signal:AbortSignal;resolve:(response:Response)=>void}>=[];
  const fetcher=((_input,init)=>new Promise<Response>(resolve=>{
    requests.push({signal:init!.signal!,resolve});
  })) as FetchStub;
  return {requests,fetcher};
}
const json=(name:string)=>Response.json({name});

it('adopts an uncached in-flight request without aborting it or accepting the old response',async()=>{
  const {requests,fetcher}=pendingFetch();
  const runtime=createDataRuntime({fetch:fetcher});
  try {
    const stable=runtime.$fetch<{name:string}>('/old',{cache:false});
    const candidate=runtime.$fetch<{name:string}>('/new',{cache:false});
    await waitFor(()=>expect(requests).toHaveLength(2));
    const operation=fetchResourceOperationId(candidate);
    rebindFetchResourceFrom(stable,candidate);
    expect(fetchResourceOperationId(stable)).toBe(operation);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.signal.aborted).toBe(false);
    await expect(candidate.refresh()).rejects.toThrow('disposed');
    requests[1]!.resolve(json('new'));
    expect(await runtime.settle()).toBe(true);
    expect(stable.data).toEqual({name:'new'});
    requests[0]!.resolve(json('old'));
    await Promise.resolve();await Promise.resolve();
    expect(stable.data).toEqual({name:'new'});
  } finally {runtime.clear();}
});

it('rejects cross-runtime adoption, retiring only the temporary candidate',async()=>{
  const {requests,fetcher}=pendingFetch();
  const owner=createDataRuntime({fetch:async()=>json('owner')});
  const other=createDataRuntime({fetch:fetcher});
  try {
    const stable=owner.$fetch<{name:string}>('/owner');
    expect(await owner.settle()).toBe(true);
    const candidate=other.$fetch<{name:string}>('/candidate',{cache:false});
    await waitFor(()=>expect(requests).toHaveLength(1));
    expect(()=>rebindFetchResourceFrom(stable,candidate)).toThrow('different data runtimes');
    expect(requests[0]!.signal.aborted).toBe(true);
    await expect(candidate.refresh()).rejects.toThrow('disposed');
    expect(stable.data).toEqual({name:'owner'});
    await stable.refresh();expect(stable.data).toEqual({name:'owner'});
  } finally {owner.clear();other.clear();}
});

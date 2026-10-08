import { waitFor } from '../../../test-support/helpers';
import { describe, expect, it, vi } from 'bun:test';
import {
  createRouteRuntime,
  registerRoutedPreparation,
  serializeRoutedPreparationState,
} from '../src/internal';
import { prepareRoutedMatches } from '../src/preparation';

describe('route preparation cancellation', () => {
  it('publishes no parent gate value when a later child gate fails', async () => {
    registerRoutedPreparation({id:'atomic-parent',server:false,prepare:()=> 'parent data'});
    registerRoutedPreparation({id:'atomic-child',server:false,prepare:()=> {throw new Error('child failed');}});
    const runtime=createRouteRuntime({environment:{},routes:[
      {id:'parent',pattern:'/parent',metadata:{preparations:['atomic-parent']}},
      {id:'child',parentId:'parent',pattern:'/child',metadata:{preparations:['atomic-child']}},
    ]});
    try {
      const result=runtime.navigate('/parent/child');
      if(result.status!=='preparing')throw new Error('Expected preparation');
      await expect(result.finished).rejects.toThrow('child failed');
      expect(serializeRoutedPreparationState(runtime)).toBeUndefined();expect(runtime.route.pathname).toBe('/');
      const parent=runtime.navigate('/parent');if(parent.status!=='preparing')throw new Error('Expected preparation');
      await parent.finished;expect(serializeRoutedPreparationState(runtime)?.entries.map(entry=>entry.data)).toEqual(['parent data']);
    } finally {runtime.dispose();}
  });

  it('keeps module and gate metadata reads in their original order', async () => {
    const order:string[]=[];
    const metadata={get componentKey(){order.push('key');return undefined;},
      get moduleLoader(){order.push('loader');return undefined;},get preparations(){order.push('gates');return [];}};
    const runtime=createRouteRuntime({environment:{}});
    try {
      await prepareRoutedMatches(runtime,[{id:'home',pattern:'/',pathname:'/',params:{},metadata}],
        {href:runtime.route.href,params:{},signal:runtime.route.signal});
      expect(order).toEqual(['key','loader','gates']);
    } finally {runtime.dispose();}
  });
  it('settles supersession without waiting for an uncooperative gate and ignores its late data', async () => {
    let release!: (value: string) => void;
    registerRoutedPreparation({
      id: 'cancel-late-result', server: false,
      prepare: ({ query }) => query.get('version') === 'old'
        ? new Promise<string>(resolve => { release = resolve; })
        : 'new data',
    });
    const runtime = createRouteRuntime({ environment: {}, routes: [{
      id: 'report', pattern: '/report', metadata: { preparations: ['cancel-late-result'] },
    }] });
    try {
      const old = runtime.navigate('/report', { query: { version: 'old' } });
      if (old.status !== 'preparing') throw new Error('Expected preparation');
      let canceled = false;
      const completion = old.finished.catch(error => {
        expect(error).toMatchObject({ name: 'AbortError' });
        canceled = true;
      });
      await waitFor(() => expect(release).toBeTypeOf('function'));
      const next = runtime.navigate('/report', { query: { version: 'new' } });
      if (next.status !== 'preparing') throw new Error('Expected preparation');
      await next.finished;
      await waitFor(() => expect(canceled).toBe(true));
      expect(serializeRoutedPreparationState(runtime)?.entries[0]?.data).toBe('new data');
      release('stale data');
      await completion;
      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(serializeRoutedPreparationState(runtime)?.entries[0]?.data).toBe('new data');
      expect(runtime.route.search).toBe('?version=new');
    } finally {
      runtime.dispose();
    }
  });

  it('does not start child preparation after canceling a pending parent settlement', async () => {
    let reject!: (error: Error) => void;
    const settle = vi.fn(() => new Promise<string>((_, fail) => { reject = fail; }));
    const child = vi.fn(() => 'child');
    registerRoutedPreparation({ id: 'cancel-settlement', server: false, prepare: () => 'holder', settle });
    registerRoutedPreparation({ id: 'cancel-child', server: false, prepare: child });
    const runtime = createRouteRuntime({ environment: {}, routes: [
      { id: 'parent', pattern: '/parent', metadata: { preparations: ['cancel-settlement'] } },
      { id: 'child', pattern: '/child', parentId: 'parent', metadata: { preparations: ['cancel-child'] } },
      { id: 'other', pattern: '/other' },
    ] });
    try {
      const old = runtime.navigate('/parent/child');
      if (old.status !== 'preparing') throw new Error('Expected preparation');
      let canceled = false;
      const completion = old.finished.catch(error => {
        expect(error).toMatchObject({ name: 'AbortError' });
        canceled = true;
      });
      await waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
      runtime.navigate('/other');
      await waitFor(() => expect(canceled).toBe(true));
      reject(new Error('late failure'));
      await completion;
      expect(child).not.toHaveBeenCalled();
      expect(serializeRoutedPreparationState(runtime)).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it('releases a pending navigation when the runtime is disposed', async () => {
    const prepare = vi.fn(() => new Promise<never>(() => {}));
    registerRoutedPreparation({ id: 'cancel-dispose', server: false, prepare });
    const runtime = createRouteRuntime({ environment: {}, routes: [{
      id: 'disposed', pattern: '/disposed', metadata: { preparations: ['cancel-dispose'] },
    }] });
    const result = runtime.navigate('/disposed');
    if (result.status !== 'preparing') throw new Error('Expected preparation');
    const completion = result.finished.then(() => { throw new Error('Expected promise rejection'); }, error => error);
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    runtime.dispose();
    expect(await completion).toMatchObject({ name: 'AbortError' });
    expect(serializeRoutedPreparationState(runtime)).toBeUndefined();
  });

  it('rejects already-aborted initial work even for a match with no gates', async () => {
    const runtime = createRouteRuntime({ environment: {} });
    const controller = new AbortController();
    const reason = new Error('request ended');
    controller.abort(reason);
    try {
      await expect(prepareRoutedMatches(runtime, [], {
        href: runtime.route.href, params: {}, signal: controller.signal,
      })).rejects.toBe(reason);
      expect(serializeRoutedPreparationState(runtime)).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });
});

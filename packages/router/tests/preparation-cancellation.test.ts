import { describe, expect, it, vi } from 'vitest';
import {
  createRouteRuntime,
  registerRoutedPreparation,
  serializeRoutedPreparationState,
} from '../src/internal';
import { prepareRoutedMatches } from '../src/preparation';

describe('route preparation cancellation', () => {
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
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const next = runtime.navigate('/report', { query: { version: 'new' } });
      if (next.status !== 'preparing') throw new Error('Expected preparation');
      await next.finished;
      await vi.waitFor(() => expect(canceled).toBe(true));
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
      await vi.waitFor(() => expect(settle).toHaveBeenCalledOnce());
      runtime.navigate('/other');
      await vi.waitFor(() => expect(canceled).toBe(true));
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
    const completion = expect(result.finished).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    runtime.dispose();
    await completion;
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

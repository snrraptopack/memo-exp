import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApplicationRuntime, createRenderPreparation, getEntity, markDirty,
  register, runWithApplicationRuntime, setScheduler, unregister,
  type ApplicationRuntime,
} from '@memoized-dom/runtime/testing';
import { createDataRuntime, type ResolvedValue } from '@memoized-dom/data';
import {
  deriveResolvedValues, readResolvedValueForRender, readResolvedValuesForRender,
  resolvedValuesPending, runResolvedValuesEffect,
} from '@memoized-dom/data/internal';

function dependency() {
  let status: 'pending' | 'ready' | 'error' = 'pending';
  let error: unknown;
  const listeners = new Set<() => void>();
  return {
    key: {},
    snapshot: () => ({ status, error }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      listener(); // Like resources, subscriptions may immediately report state.
      return () => { listeners.delete(listener); };
    },
    settle(next: typeof status = 'ready', cause?: unknown) {
      status = next;
      error = cause;
      // Snapshot listeners: synchronous renders can replace subscriptions.
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...listeners]) listener();
    },
    get listeners() { return listeners.size; },
  };
}

describe('consumed-resource preparation readiness', () => {
  let runtime: ApplicationRuntime;
  let jobs: Array<() => void>;
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const flush = () => inRuntime(() => { while (jobs.length) jobs.shift()!(); });
  beforeEach(() => {
    jobs = [];
    runtime = createApplicationRuntime('preparation-readiness', { document, schedule: null });
    inRuntime(() => setScheduler(run => jobs.push(run)));
  });
  afterEach(() => runtime.dispose());

  it('does not treat resource declaration or work outside a read scope as consumption', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const unused = dependency();
    preparation.run(() => {
      register({ id: 'root', parent: null, render() {} });
      preparation.consume(unused);
      expect(preparation.readiness).toBe('pending'); // Creation still running.
    });
    expect(preparation.readiness).toBe('ready');
    expect(unused.listeners).toBe(0);
  });

  it('keeps resources and component identity stable across settlement and discovery', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const first = dependency();
    const second = dependency();
    const createChild = vi.fn(() => register({
      id: 'root/child', parent: 'root',
      render: () => preparation.collect('root/child', () => { preparation.consume(second); }),
    }));
    const root = {
      id: 'root', parent: null,
      render() {
        preparation.collect('root', () => {
          preparation.consume(first);
          if (first.snapshot().status === 'ready' && !getEntity('root/child')) {
            createChild();
            preparation.collect('root/child', () => preparation.consume(second));
          }
        });
      },
    };
    preparation.run(() => register(root));
    preparation.collect('root', () => root.render());
    expect(first.listeners).toBe(1);
    first.settle();
    // No requests presently pending, but the conditional render is queued.
    expect(preparation.readiness).toBe('pending');
    expect(() => preparation.activate()).toThrow(/render discovery/);
    flush();
    expect(preparation.readiness).toBe('pending');
    expect(createChild).toHaveBeenCalledTimes(1);
    second.settle();
    expect(preparation.readiness).toBe('pending');
    flush();
    expect(preparation.readiness).toBe('ready');
    expect(inRuntime(() => getEntity('root'))).toBe(root);
    preparation.activate();
    expect(first.listeners).toBe(0);
    expect(second.listeners).toBe(0);
    expect(createChild).toHaveBeenCalledTimes(1);
  });

  it('replaces an owner read set when a conditional stops consuming a source', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const source = dependency();
    let show = true;
    const render = () => preparation.collect('root', () => { if (show) preparation.consume(source); });
    preparation.run(() => register({ id: 'root', parent: null, render }));
    preparation.collect('root', render);
    expect(preparation.readiness).toBe('pending');
    show = false;
    inRuntime(() => markDirty('root'));
    flush();
    expect(source.listeners).toBe(0);
    expect(preparation.readiness).toBe('ready');
  });

  it('shares one observation, releasing only the removed owner claims', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const source = dependency();
    preparation.run(() => {
      register({ id: 'root', parent: null, render() {} });
      for (const id of ['root/left', 'root/right']) {
        register({ id, parent: 'root', render() {} });
        preparation.collect(id, () => preparation.consume(source));
      }
    });
    expect(source.listeners).toBe(1);
    inRuntime(() => unregister('root/left'));
    expect(source.listeners).toBe(1);
    inRuntime(() => unregister('root/right'));
    expect(source.listeners).toBe(0);
    expect(preparation.readiness).toBe('ready');
  });

  it('holds nested readiness and reports the original failure without activating', () => {
    const outer = inRuntime(() => createRenderPreparation());
    const inner = outer.run(() => createRenderPreparation());
    const source = dependency();
    outer.run(() => register({ id: 'root', parent: null, render() {} }));
    inner.run(() => register({
      id: 'root/child', parent: 'root',
      render() { inner.collect('root/child', () => inner.consume(source)); },
    }));
    inner.collect('root/child', () => inner.consume(source));
    expect(outer.readiness).toBe('pending');
    const failure = new Error('download failed');
    source.settle('error', failure);
    flush();
    expect(inner.readiness).toBe('error');
    expect(outer.errors).toEqual([failure]);
    expect(() => outer.activate()).toThrow(/consumed resources/);
    inner.dispose();
    expect(outer.readiness).toBe('ready');
    outer.activate();
  });

  it('ignores completion from an abandoned generation', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const source = dependency();
    const render = vi.fn(() => preparation.collect('root', () => preparation.consume(source)));
    preparation.run(() => register({ id: 'root', parent: null, render }));
    preparation.collect('root', render);
    preparation.dispose();
    source.settle();
    flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(source.listeners).toBe(0);
    expect(preparation.status).toBe('disposed');
  });

  it('tracks all render prerequisites despite short-circuit reads, not unused derivations or effects', async () => {
    const requests: Array<(response: Response) => void> = [];
    const data = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: () => new Promise(resolve => { requests.push(resolve); }),
    });
    try {
      const first = data.$fetch<{ name: string }>('/first');
      const second = data.$fetch<{ name: string }>('/second');
      const unused = data.$fetch('/unused');
      // Mirror the compiler's hidden-source ABI, not the authored payload API.
      const firstValue = first as unknown as ResolvedValue<{ name: string }>;
      const secondValue = second as unknown as ResolvedValue<{ name: string }>;
      const unusedValue = unused as unknown as ResolvedValue<unknown>;
      const preparation = inRuntime(() => createRenderPreparation());
      const render = () => preparation.collect('root', () => {
        deriveResolvedValues([unusedValue], () => {});
        runResolvedValuesEffect([unusedValue], () => {});
        resolvedValuesPending([firstValue, secondValue]);
        readResolvedValuesForRender([firstValue, secondValue], () => {});
        readResolvedValueForRender(firstValue);
      });
      preparation.run(() => register({ id: 'root', parent: null, render }));
      preparation.collect('root', render);
      expect(preparation.readiness).toBe('pending');
      await vi.waitFor(() => expect(requests).toHaveLength(3));
      requests[0]!(new Response(JSON.stringify({ name: 'Ada' })));
      await vi.waitFor(() => expect(first.status).toBe('success'));
      flush();
      expect(preparation.readiness).toBe('pending');
      requests[1]!(new Response(JSON.stringify({ name: 'Grace' })));
      await vi.waitFor(() => expect(second.status).toBe('success'));
      flush();
      expect(preparation.readiness).toBe('ready');
      expect(unused.status).not.toBe('success');
      preparation.dispose();
      // Claims are borrowed; abandonment must not abort the live resource.
      expect(first.status).toBe('success');
    } finally { data.clear(); }
  });

  it('merges reentrant reads for the same owner without losing outer claims', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const first = dependency();
    const second = dependency();
    preparation.run(() => register({ id: 'root', parent: null, render() {} }));
    preparation.collect('root', () => {
      preparation.consume(first);
      preparation.collect('root', () => preparation.consume(second));
    });
    expect(first.listeners).toBe(1);
    expect(second.listeners).toBe(1);
    preparation.collect('root', () => {});
    expect(first.listeners).toBe(0);
    expect(second.listeners).toBe(0);
  });

  it('keeps borrowed observations isolated between generations in different runtimes', () => {
    const other = createApplicationRuntime('other', { document, schedule: null });
    const source = dependency();
    const left = inRuntime(() => createRenderPreparation());
    const right = runWithApplicationRuntime(other, () => createRenderPreparation());
    try {
      for (const preparation of [left, right]) {
        preparation.run(() => register({
          id: 'root', parent: null,
          render() { preparation.collect('root', () => preparation.consume(source)); },
        }));
        preparation.collect('root', () => preparation.consume(source));
      }
      expect(source.listeners).toBe(2);
      left.dispose();
      expect(source.listeners).toBe(1);
      runWithApplicationRuntime(other, () => setScheduler(run => run()));
      source.settle();
      expect(right.readiness).toBe('ready');
      right.activate();
      expect(source.listeners).toBe(0);
    } finally { other.dispose(); }
  });

  it('preserves skipped sink claims when only another sink is replayed', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const first = dependency();
    const second = dependency();
    preparation.run(() => register({ id: 'root', parent: null, render() {} }));
    preparation.collect('root', () => preparation.consume(first), 'title');
    preparation.collect('root', () => preparation.consume(second), 'body');
    preparation.collect('root', () => {}, 'title');
    expect(first.listeners).toBe(0);
    expect(second.listeners).toBe(1);
    expect(preparation.readiness).toBe('pending');
    inRuntime(() => unregister('root'));
    expect(second.listeners).toBe(0);
  });

  it('releases claims when a read removes its own owner during discovery', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const source = dependency();
    preparation.run(() => {
      register({ id: 'root', parent: null, render() {} });
      register({ id: 'root/removed', parent: 'root', render() {} });
    });
    preparation.collect('root/removed', () => {
      preparation.consume(source);
      unregister('root/removed');
    });
    expect(source.listeners).toBe(0);
    expect(preparation.readiness).toBe('ready');
  });
});

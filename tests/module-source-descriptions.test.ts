/**
 * RFC §16.4 / §16.8.3 — runtime-owned module source descriptions.
 *
 * Proves the materialization contract over ONE shared compiled module record:
 * 1. Two mounted application roots + concurrent requests materialize
 *    independent instances (no cross-root sharing through the module).
 * 2. DataRuntime.clear() retires materialized instances; the next read
 *    re-materializes and re-issues the request.
 * 3. HMR description replacement bumps the description version and retires
 *    stale instances in every runtime instead of silently reusing them.
 * 4. Descriptions never fire requests at module evaluation.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationRuntime,
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';
import {
  createSource,
  describeModuleSource,
  readModuleSourceList,
  readResolvedValueForRender,
  resolveModuleSource,
  sourceRef,
} from '@memoized-dom/data/internal';

function fetchCalls(): { calls: string[]; fetch: typeof fetch } {
  const calls: string[] = [];
  // Explicit Response construction (mirroring examples/workspace/api.ts):
  // happy-dom's Response.json() static does not settle through the decode
  // chain reliably in this environment.
  const fetch = ((url: RequestInfo | URL) => {
    calls.push(String(url).split('/').pop() ?? '');
    return Promise.resolve(
      new Response(JSON.stringify([1, 2, 3]), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, fetch };
}

function withRequest(
  id: string,
  fetch: typeof fetch,
  fn: () => void,
): void {
  const application = createApplicationRuntime(id);
  runWithApplicationRuntime(application, () => {
    const previous = setActiveDataRuntime(createDataRuntime({ fetch }));
    try {
      fn();
    } finally {
      setActiveDataRuntime(previous);
    }
  });
}

describe('runtime-owned module source descriptions (RFC §16.4)', () => {
  it('materializes independent instances for two roots over one shared record', async () => {
    const { calls, fetch } = fetchCalls();
    describeModuleSource('shared#list', () => createSource('/api/list/1'));

    // One STABLE application runtime per root: the instance cache is keyed
    // by the runtime, so materialize + read must share the same handle.
    const makeRoot = (id: string) => {
      const application = createApplicationRuntime(id);
      let instance: unknown;
      runWithApplicationRuntime(application, () => {
        setActiveDataRuntime(createDataRuntime({ fetch }));
        instance = resolveModuleSource(sourceRef('shared#list'));
      });
      return { application, instance };
    };

    const rootA = makeRoot('root-a');
    const rootB = makeRoot('root-b');

    // Different instances per application runtime...
    expect(rootA.instance).not.toBe(rootB.instance);
    // ...each issued its own request.
    expect(calls).toEqual(['1', '1']);

    // Reads resolve within their own runtime's instance once committed.
    await vi.waitFor(() => {
      runWithApplicationRuntime(rootA.application, () => {
        expect(readModuleSourceList(sourceRef('shared#list'))).toEqual([
          1, 2, 3,
        ]);
      });
    }, { timeout: 2000, interval: 10 });
    await vi.waitFor(() => {
      runWithApplicationRuntime(rootB.application, () => {
        expect(readModuleSourceList(sourceRef('shared#list'))).toEqual([
          1, 2, 3,
        ]);
      });
    }, { timeout: 2000, interval: 10 });
    // Committed instances are reused — no duplicate requests.
    expect(calls).toEqual(['1', '1']);
  });

  it('retires instances on DataRuntime.clear() and re-materializes', async () => {
    const { calls, fetch } = fetchCalls();
    describeModuleSource('clear#list', () => createSource('/api/list/2'));
    const application = createApplicationRuntime('clear-1');
    const data = createDataRuntime({ fetch });

    runWithApplicationRuntime(application, () => {
      setActiveDataRuntime(data);
      expect(
        readResolvedValueForRender(sourceRef('clear#list')),
      ).toBeUndefined();
    });
    let first: unknown;
    runWithApplicationRuntime(application, () => {
      setActiveDataRuntime(data);
      first = resolveModuleSource(sourceRef('clear#list'));
    });
    expect(calls).toHaveLength(1);

    data.clear();
    let second: unknown;
    runWithApplicationRuntime(application, () => {
      setActiveDataRuntime(data);
      second = resolveModuleSource(sourceRef('clear#list'));
    });
    expect(second).not.toBe(first);
    expect(calls).toHaveLength(2);
  });

  it('retires stale instances in every runtime when HMR replaces the description', () => {
    const firstFetch = fetchCalls();
    const secondFetch = fetchCalls();
    describeModuleSource('hmr#list', () => createSource('/api/list/first'));
    const applicationA = createApplicationRuntime('hmr-a');
    const applicationB = createApplicationRuntime('hmr-b');
    const firstDataA = createDataRuntime({ fetch: firstFetch.fetch });
    const firstDataB = createDataRuntime({ fetch: firstFetch.fetch });

    let runtimeA: unknown;
    runWithApplicationRuntime(applicationA, () => {
      setActiveDataRuntime(firstDataA);
      runtimeA = resolveModuleSource(sourceRef('hmr#list'));
    });
    let runtimeB: unknown;
    runWithApplicationRuntime(applicationB, () => {
      setActiveDataRuntime(firstDataB);
      runtimeB = resolveModuleSource(sourceRef('hmr#list'));
    });
    expect(firstFetch.calls).toHaveLength(2);

    describeModuleSource('hmr#list', () => createSource('/api/list/second'));
    const secondDataA = createDataRuntime({ fetch: secondFetch.fetch });
    const secondDataB = createDataRuntime({ fetch: secondFetch.fetch });

    let runtimeA2: unknown;
    runWithApplicationRuntime(applicationA, () => {
      setActiveDataRuntime(secondDataA);
      runtimeA2 = resolveModuleSource(sourceRef('hmr#list'));
    });
    let runtimeB2: unknown;
    runWithApplicationRuntime(applicationB, () => {
      setActiveDataRuntime(secondDataB);
      runtimeB2 = resolveModuleSource(sourceRef('hmr#list'));
    });
    expect(runtimeA2).not.toBe(runtimeA);
    expect(runtimeB2).not.toBe(runtimeB);
    expect(runtimeA2).not.toBe(runtimeB2);
    expect(secondFetch.calls).toHaveLength(2);

    // The old request can finish disposal after replacement without deleting
    // the replacement entry from its application-runtime cache.
    firstDataA.clear();
    runWithApplicationRuntime(applicationA, () => {
      setActiveDataRuntime(secondDataA);
      expect(resolveModuleSource(sourceRef('hmr#list'))).toBe(runtimeA2);
    });
    expect(secondFetch.calls).toHaveLength(2);
  });

  it('descriptions never fire requests at module evaluation', () => {
    const { calls, fetch } = fetchCalls();
    describeModuleSource('lazy#list', () => createSource('/api/list/3'));
    expect(calls).toEqual([]);
    withRequest('lazy-1', fetch, () => {
      resolveModuleSource(sourceRef('lazy#list'));
    });
    expect(calls).toEqual(['3']);
  });
});

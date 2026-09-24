/**
 * RFC §16.6/§16.8.5 — source-state snapshot envelope.
 *
 * Serialize/restore must cover success, pending, error, and refreshing
 * states; restore must claim by deterministic request identity, never
 * re-issue a duplicate request for restored success, keep restored errors
 * retryable through their own handle, and sanitize error payloads.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';

function makeRuntime(options: {
  responses: Array<Record<string, unknown>>;
  calls: string[];
}) {
  const fetch = ((url: RequestInfo | URL) => {
    const path = String(url);
    const match = options.responses.find((entry) =>
      Object.keys(entry).some((key) => path.includes(key)),
    );
    const key =
      match === undefined
        ? path
        : Object.keys(match).find((candidate) => path.includes(candidate)) ??
          path;
    options.calls.push(key);
    const body = match === undefined ? {} : match[key];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return createDataRuntime({ fetch });
}

describe('source-state snapshot envelope (RFC §16.6)', () => {
  it('restores committed success without a duplicate request', async () => {
    const source = makeRuntime({
      responses: [{ '/api/items': [{ id: 'n1' }] }],
      calls: [],
    });
    setActiveDataRuntime(source);
    const resource = source.$fetch('/api/items');
    await vi.waitFor(() => {
      expect(resource.status).toBe('success');
    });
    const envelope = source.serializeState();
    expect(envelope.formatVersion).toBe(1);
    expect(envelope.sources).toHaveLength(1);
    expect(envelope.sources[0]?.snapshot).toMatchObject({
      status: 'success',
      data: [{ id: 'n1' }],
      revalidate: false,
    });

    const calls: string[] = [];
    const target = makeRuntime({ responses: [], calls });
    target.restoreState(envelope);
    setActiveDataRuntime(target);
    const restored = target.$fetch('/api/items');
    await Promise.resolve();
    await Promise.resolve();
    expect(restored.data).toEqual([{ id: 'n1' }]);
    expect(restored.status).toBe('success');
    expect(calls).toEqual([]);
  });

  it('resumes a restored pending request on the client', async () => {
    const pending = Promise.withResolvers<Response>();
    const calls: string[] = [];
    const neverFetch = ((url: RequestInfo | URL) => {
      calls.push(String(url));
      return pending.promise;
    }) as typeof fetch;
    const source = createDataRuntime({ fetch: neverFetch });
    setActiveDataRuntime(source);
    source.$fetch('/api/slow');
    const envelope = source.serializeState();
    expect(envelope.sources[0]?.snapshot).toEqual({ status: 'pending' });

    const targetCalls: string[] = [];
    const target = makeRuntime({
      responses: [{ '/api/slow': [{ id: 'n2' }] }],
      calls: targetCalls,
    });
    target.restoreState(envelope);
    setActiveDataRuntime(target);
    const restored = target.$fetch('/api/slow');
    await vi.waitFor(() => {
      expect(restored.status).toBe('success');
    });
    expect(targetCalls).toEqual(['/api/slow']);
  });

  it('restores sanitized errors that stay retryable', async () => {
    const failing = createDataRuntime({
      fetch: (() => Promise.reject(new Error('network down'))) as typeof fetch,
    });
    setActiveDataRuntime(failing);
    const resource = failing.$fetch('/api/fail');
    await vi.waitFor(() => {
      expect(resource.status).toBe('error');
    });
    const envelope = failing.serializeState();
    const snapshot = envelope.sources[0]?.snapshot;
    expect(snapshot?.status).toBe('error');
    if (snapshot?.status === 'error') {
      expect(Object.keys(snapshot.error).sort()).toEqual([
        'kind',
        'message',
        'status',
        'statusText',
      ]);
    }

    const calls: string[] = [];
    const target = makeRuntime({
      responses: [{ '/api/fail': ['recovered'] }],
      calls,
    });
    target.restoreState(envelope);
    setActiveDataRuntime(target);
    const restored = target.$fetch('/api/fail');
    expect(restored.status).toBe('error');
    expect(calls).toEqual([]);

    restored.refresh();
    await vi.waitFor(() => {
      expect(restored.data).toEqual(['recovered']);
    });
    expect(calls).toEqual(['/api/fail']);
  });

  it('transfers refreshing as committed payload plus revalidate intent', async () => {
    let refreshCount = 0;
    const runtime = createDataRuntime({
      fetch: (() => {
        refreshCount++;
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 'n1' }]), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }) as typeof fetch,
    });
    setActiveDataRuntime(runtime);
    const resource = runtime.$fetch('/api/items');
    await vi.waitFor(() => {
      expect(resource.status).toBe('success');
    });
    resource.refresh();
    const envelope = runtime.serializeState();
    expect(envelope.sources[0]?.snapshot).toMatchObject({
      status: 'success',
      revalidate: true,
    });
    const before = refreshCount;

    const target = createDataRuntime({
      fetch: (() => {
        refreshCount++;
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }) as typeof fetch,
    });
    target.restoreState(envelope);
    setActiveDataRuntime(target);
    const restored = target.$fetch('/api/items');
    await Promise.resolve();
    expect(restored.data).toEqual([{ id: 'n1' }]);
    expect(refreshCount).toBe(before);
  });

  it('omits idle entries from the envelope', async () => {
    const runtime = createDataRuntime({
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'application/json' },
          }),
        )) as typeof fetch,
    });
    setActiveDataRuntime(runtime);

    // A paused resource (null target) never acquires an entry: nothing to
    // transfer.
    const paused = runtime.$fetch(null);
    expect(paused.status).toBe('idle');

    const resource = runtime.$fetch('/api/ok');
    await vi.waitFor(() => {
      expect(resource.status).toBe('success');
    });
    const envelope = runtime.serializeState();
     expect(envelope.sources).toHaveLength(1);
     expect(envelope.sources[0]?.sourceId).toMatch(/^transfer:/);
     expect(envelope.sources[0]?.sourceId).not.toContain('/api/ok');
  });
});

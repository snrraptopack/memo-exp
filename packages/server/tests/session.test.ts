// @vitest-environment node
/**
 * Render session contract: every renderer reports how data settlement
 * concluded, and one render-owned abort (caller signal, stream reader
 * cancellation, or hard deadline) stops route preparation and data work.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  renderToReadableStream,
  render,
} from '../src/index';
import { compileFixture, type CompiledTiers } from './parity-harness';
import { prepareRenderToReadableStream } from '../src/stream';

let data: CompiledTiers;
let routed: CompiledTiers;
let preparationSignals: AbortSignal[];

beforeAll(async () => {
  data = await compileFixture('session-data', `
    import { $fetch, Group } from '@memoized-dom/data';

    function Pending() {
      return <p class="pending">Loading</p>;
    }

    export function App() {
      const user = $fetch('/api/user');
      return (
        <main>
          <Group pending={Pending}>
            <h1>{user.name}</h1>
          </Group>
        </main>
      );
    }
  `);
  routed = await compileFixture('session-routed', `
    import { $routed } from '@memoized-dom/router';

    export function Report() {
      const page = $routed(({ signal }) => {
        globalThis.__sessionPreparationSignals.push(signal);
        return new Promise(() => {});
      });
      return <main route="/reports/:id"><h1>{page.title}</h1></main>;
    }
  `, { routedEnvironment: 'server' }, 'Report');
});

function jsonFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

/** A fetch that never settles but records the signal it was handed. */
function hangingFetch(): { fetch: typeof fetch; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  }) as unknown as typeof globalThis.fetch;
  return { fetch, signals };
}

function routedContext(url: string) {
  preparationSignals = [];
  (globalThis as { __sessionPreparationSignals?: AbortSignal[] })
    .__sessionPreparationSignals = preparationSignals;
  return {
    request: new Request(`https://app.test${url}`),
    locals: {},
    services: {},
  };
}

describe('render session', () => {
  it('reports shell, complete, and timeout settlement', async () => {
    const shell = await render(data.serverModule.App, {
      fetch: jsonFetch({ name: 'Ada' }),
    });
    expect(shell.settlement).toEqual({ status: 'shell' });

    const complete = await render(data.serverModule.App, {
      mode: 'resolve',
      fetch: jsonFetch({ name: 'Ada' }),
    });
    expect(complete.settlement.status).toBe('complete');
    expect(complete.html).toContain('<h1>Ada</h1>');

    const timedOut = await render(data.serverModule.App, {
      mode: 'resolve',
      timeout: 20,
      fetch: hangingFetch().fetch,
    });
    expect(timedOut.settlement.status).toBe('timeout');
    expect(timedOut.html).toContain('class="pending"');
  });

  it('aborts in-flight data work when the stream reader cancels', async () => {
    const request = hangingFetch();
    const reader = renderToReadableStream(data.serverModule.App, {
      mode: 'resolve',
      fetch: request.fetch,
    }).getReader();
    const read = reader.read();
    await expect.poll(() => request.signals.length).toBe(1);

    await reader.cancel(new Error('consumer went away'));
    expect(request.signals[0]!.aborted).toBe(true);
    await expect(read).resolves.toEqual({ done: true, value: undefined });
  });

  it('propagates the caller signal into route preparation', async () => {
    const abort = new AbortController();
    const rendering = render(routed.serverModule.Report, {
      url: '/reports/7',
      routedContext: routedContext('/reports/7'),
      signal: abort.signal,
    });
    await expect.poll(() => preparationSignals.length).toBe(1);

    abort.abort(new Error('client disconnected'));
    await expect(rendering).rejects.toThrow('client disconnected');
    expect(preparationSignals[0]!.aborted).toBe(true);
  });

  it('cancels request work after a region-streaming shell was delivered', async () => {
    const request = hangingFetch();
    const reader = renderToReadableStream(data.serverModule.App, {
      mode: 'stream', markers: true, fetch: request.fetch,
    }).getReader();
    const shell = await reader.read();
    expect(new TextDecoder().decode(shell.value)).toContain('class="pending"');
    const waiting = reader.read();
    await reader.cancel(new Error('consumer left after shell'));
    expect(request.signals[0]!.aborted).toBe(true);
    await expect(waiting).resolves.toEqual({done:true, value:undefined});
  });

  it('rejects a render that exceeds its hard deadline', async () => {
    const rendering = render(routed.serverModule.Report, {
      url: '/reports/7',
      routedContext: routedContext('/reports/7'),
      deadline: 30,
    });
    await expect(rendering).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(preparationSignals[0]!.aborted).toBe(true);
  });

  it('honors the deadline while region output waits for a slow reader', async () => {
    const prepared = prepareRenderToReadableStream(data.serverModule.App, {
      mode:'stream', markers:true, fetch:jsonFetch({name:'Ada'}), deadline:250,
    });
    try {
      await prepared.prepared;
      await expect(prepared.ready).rejects.toMatchObject({name:'TimeoutError'});
      const reader = prepared.stream.getReader();
      const shell = await reader.read();
      expect(new TextDecoder().decode(shell.value)).toContain('class="pending"');
      await reader.cancel();
    } finally { await prepared.stream.cancel().catch(() => {}); }
  });
});

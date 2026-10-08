import { waitFor } from '../test-support/helpers';
import { describe, expect, it } from 'bun:test';
import { measureCapability } from '../bench/package-size/capability-audit';

function api<T>(code: string): T {
  return new Function(`${code};return Capability;`)() as T;
}

describe.each(['source', 'package'] as const)('optional package capabilities: %s', graph => {
  it('keeps web/Bun adapters independent of Node and the renderer', async () => {
    const html = await measureCapability('adapter-html', graph);
    const stream = await measureCapability('adapter-stream', graph);
    const bun = await measureCapability('adapter-bun', graph);
    for (const result of [html, stream, bun]) {
      expect(result.inputs.every(input => input.path === '<stdin>' || input.path.includes('/adapters/'))).toBe(true);
      expect(result.code).not.toContain('node:');
    }
    const handler = api<{ htmlResponse(value: string): Response }>(html.code);
    const response = handler.htmlResponse('hello');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('hello');
    const streams = api<{ createDocumentStream(parts: object): ReadableStream<Uint8Array> }>(stream.code);
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('body')); controller.close();
    } });
    expect(await new Response(streams.createDocumentStream({ prefix: '<main>', body, suffix: '</main>' })).text())
      .toBe('<main>body</main>');
    const adapters = api<{ createBunFetch(handler: (request: Request) => Response): (request: Request) => Response }>(bun.code);
    const request = new Request('http://localhost');
    expect(adapters.createBunFetch(() => response)(request)).toBe(response);
  });

  it('keeps server JSON independent of rendering and request-host initialization', async () => {
    const result = await measureCapability('server-json', graph);
    expect(result.code).not.toContain('node:async_hooks');
    expect(result.code).not.toContain('memoized-dom:server-context');
    expect(result.inputs.every(input => input.path === '<stdin>' || /\/server\/(?:src|dist)\/json\.(?:ts|js)$/.test(input.path))).toBe(true);
    const server = api<{ json(value: object): Response }>(result.code);
    expect(await server.json({ name: 'Ada' }).json()).toEqual({ name: 'Ada' });
  });

  it('retains the string renderer without the optional LinkeDOM oracle', async () => {
    const result = await measureCapability('server-string', graph);
    expect(result.inputs.some(input => input.path.includes('string-document'))).toBe(true);
    expect(result.inputs.some(input => input.path.includes('linkedom'))).toBe(false);
    expect(result.code).toContain('node:async_hooks');
  });

  it('keeps Node request conversion independent of response streaming and rendering', async () => {
    const result = await measureCapability('adapter-node-request', graph);
    expect(result.inputs.every(input => input.path === '<stdin>' || input.path.includes('/adapters/'))).toBe(true);
    expect(result.code).not.toContain('getReader');
    expect(result.code).not.toContain('waitForDrainOrClose');
  });

  it('tracks optimistic promises without retaining the full form tracker', async () => {
    const result = await measureCapability('optimistic', graph);
    expect(result.code).not.toContain('Validation failed');
    // Generic resource helpers still recognize forms; the attempt tracker is optional.
    expect(result.code).not.toContain('.executing');
    const utility = api<{ optimistic(options: object): (value: number) => Promise<number> }>(result.code);
    let resolve!: (value: number) => void;
    let reject!: (error: Error) => void;
    let count = 0;
    const saved: number[] = [];
    const success = new Promise<number>(accept => { resolve = accept; });
    const failure = new Promise<number>((_accept, fail) => { reject = fail; });
    const update = utility.optimistic({ action: (value: number) => value === 1 ? success : failure,
      apply: () => { count++; return () => count--; }, reconcile: (value: number) => saved.push(value) });
    expect(update(1)).toBe(success); expect(update(2)).toBe(failure); expect(count).toBe(2);
    resolve(10); reject(new Error('failed'));
    await waitFor(() => { expect(saved).toEqual([10]); expect(count).toBe(1); });
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeDocumentStream } from '../src/document';
import { splitDocumentTemplate } from '../src/document';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';

describe('compiler document identity', () => {
  const key = 'a'.repeat(64);
  const script = `<script type="module" nonce='src="nonce-value"' crossorigin src="/entry.js"></script>`;
  const preload = '<link rel="modulepreload" href="/dependency.js">';
  const shell = (bootstrap: string) => `<!doctype html><head>${bootstrap}</head><body><div id="root"><!--ssr-outlet--></div></body>`;

  it('preserves the sole bootstrap, nonce and preloads without rewriting them', () => {
    const template = splitDocumentTemplate(shell(script + preload) +
      initialBootstrapDescriptor({ key, target: 'root', browser: 'bindings' }));
    expect(template.prefix).toContain(script);
    expect(template.prefix).toContain(preload);
    expect(template.initial).toEqual({ key, target: 'root', browser: 'bindings' });
    expect(template.suffix).not.toContain('initial-delivery');
  });

  it('accepts static delivery without a browser bootstrap', () => {
    const template = splitDocumentTemplate(shell('') + initialBootstrapDescriptor({ key, target: 'root', browser: 'none' }));
    expect(template.prefix).not.toMatch(/script|modulepreload/);
    expect(template.initial?.browser).toBe('none');
  });

  it.each([
    initialBootstrapDescriptor({ key, target: 'root', browser: 'none' }).repeat(2),
    '<!--mmd:initial-delivery:%invalid-->',
    '<!--mmd:initial-delivery:%7B%7D-->',
  ])('rejects malformed build identity rather than switching bootstraps', descriptor => {
    expect(() => splitDocumentTemplate(shell(script) + descriptor)).toThrow('invalid compiler delivery descriptor');
  });

  it('keeps a hand-authored document without compiler metadata', () => {
    expect(splitDocumentTemplate(shell(script + preload)).initial).toBeUndefined();
  });
});

describe('composed document stream ownership', () => {
  it('releases the body reader after normal completion', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('body'));
        controller.close();
      },
    });
    const stream = composeDocumentStream({ prefix: '<main>', body, suffix: '</main>' });
    expect(await new Response(stream).text()).toBe('<main>body</main>');
    expect(body.locked).toBe(false);
  });

  it.each([false, true])('releases a failed body reader (recovery=%s)', async recovery => {
    const failure = new Error('body failed');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
    const stream = composeDocumentStream({
      prefix: '<main>', body, suffix: '</main>',
      ...(recovery ? { onBodyError: () => 'fallback' } : {}),
    });
    if (recovery) expect(await new Response(stream).text()).toBe('<main>fallback</main>');
    else await expect(new Response(stream).text()).rejects.toBe(failure);
    expect(body.locked).toBe(false);
  });

  it('cancels an in-flight read once and releases its reader', async () => {
    const reasons: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({ cancel(reason) { reasons.push(reason); } });
    const stream = composeDocumentStream({ prefix: 'head', body, suffix: 'tail' });
    const reader = stream.getReader();
    await reader.read();
    const pending = reader.read();
    const reason = new Error('disconnected');
    await reader.cancel(reason);
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(reasons).toEqual([reason]);
    expect(body.locked).toBe(false);
  });
});

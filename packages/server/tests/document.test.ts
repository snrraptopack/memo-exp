// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeDocumentStream } from '../src/document';

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

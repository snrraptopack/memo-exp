import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentStream } from '../src';
import { createNodeHandler } from '../src/node';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, 'close');
  }));
});

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe('runtime adapters', () => {
  it('streams document framing without buffering the application body', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<main>'));
        controller.enqueue(encoder.encode('ready</main>'));
        controller.close();
      },
    });

    await expect(text(createDocumentStream({
      prefix: '<!doctype html><body>',
      body,
      suffix: '</body>',
    }))).resolves.toBe('<!doctype html><body><main>ready</main></body>');
  });

  it('bridges Node HTTP to a streaming Web handler', async () => {
    const handler = createNodeHandler(async (request) => {
      expect(request.method).toBe('POST');
      expect(await request.text()).toBe('payload');
      return new Response('accepted', {
        status: 202,
        headers: {
          'content-type': 'text/plain',
          'x-adapter': 'node',
        },
      });
    });
    const server = createServer((request, response) => {
      void handler(request, response);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/submit`, {
      method: 'POST',
      body: 'payload',
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('x-adapter')).toBe('node');
    expect(await response.text()).toBe('accepted');
  });
});

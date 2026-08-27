import { createServer as createViteServer } from 'vite';
import { renderToReadableStream, renderToResultAsync } from '@memoized-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const dir = import.meta.dirname;

// Mock Data Endpoints for real-world SSR & Streaming
function createMockFetch(reqUrl: string): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;

    // 1. Session Endpoint (~5ms)
    if (path.includes('/api/session')) {
      return new Response(
        JSON.stringify({
          name: 'Ada Lovelace',
          role: 'Lead Architect',
          avatar: '👩‍💻',
          email: 'ada@workspace.dev',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // 2. Metrics Endpoint (~15ms)
    if (path.includes('/api/metrics')) {
      return new Response(
        JSON.stringify([
          { id: '1', label: 'SSR Throughput', value: '1,920 ops/s', delta: '+14.2%', trend: 'up' },
          { id: '2', label: 'TTFB Latency', value: '0.6 ms', delta: '-68.0%', trend: 'up' },
          { id: '3', label: 'Marker Budget', value: '7.8 KB', delta: '-82.5%', trend: 'up' },
          { id: '4', label: 'Active Sessions', value: '14,892', delta: '+3.1%', trend: 'up' },
        ]),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // 3. Feed Endpoint (~25ms)
    if (path.includes('/api/stories')) {
      return new Response(
        JSON.stringify([
          {
            id: 1,
            title: 'Memoized DOM: Zero-Cost Fine-Grained Reactivity and AOT Compilation',
            category: 'Architecture',
            author: 'Ada Lovelace',
            votes: 142,
            commentsCount: 38,
            timestamp: '12m ago',
          },
          {
            id: 2,
            title: 'Phase 6 HTTP Chunked Streaming SSR with Sub-Millisecond First Byte',
            category: 'Performance',
            author: 'Grace Hopper',
            votes: 98,
            commentsCount: 24,
            timestamp: '45m ago',
          },
          {
            id: 3,
            title: 'Eliminating In-Memory VDOM Allocations with StringDocument Tier',
            category: 'Compiler',
            author: 'Alan Turing',
            votes: 84,
            commentsCount: 19,
            timestamp: '2h ago',
          },
        ]),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    // 4. Logs Endpoint (~10ms)
    if (path.includes('/api/logs')) {
      return new Response(
        JSON.stringify([
          { id: 'l1', level: 'success', message: 'Vite SSR module graph compiled in 42ms', time: '12:04:11' },
          { id: 'l2', level: 'info', message: 'HTTP chunked stream opened for GET /?stream=true', time: '12:04:12' },
          { id: 'l3', level: 'info', message: 'Companion JSON payload envelope flushed (842 bytes)', time: '12:04:13' },
          { id: 'l4', level: 'success', message: 'Client DOM adoption completed in 0.8ms', time: '12:04:14' },
        ]),
        { headers: { 'content-type': 'application/json' } },
      );
    }

    return fetch(input as RequestInfo);
  }) as unknown as typeof globalThis.fetch;
}

// 1. Create standard Vite dev server in middleware mode
const vite = await createViteServer({
  root: dir,
  server: { middlewareMode: true },
  appType: 'custom',
});

console.log(`\n⚡ Memoized DOM Real-World Multi-Route SSR Server running on http://localhost:${PORT}\n`);
console.log(`- Dashboard Route:             http://localhost:${PORT}/`);
console.log(`- Feed Route:                  http://localhost:${PORT}/feed`);
console.log(`- Analytics Route:             http://localhost:${PORT}/analytics`);
console.log(`- Settings Route:              http://localhost:${PORT}/settings`);
console.log(`- HTTP Chunked Streaming SSR:  http://localhost:${PORT}/?stream=true\n`);

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url);

    // Serve mock APIs for client-side queries
    if (url.pathname.startsWith('/api/')) {
      const mockFetch = createMockFetch(req.url);
      return mockFetch(url.pathname);
    }

    // 2. Let Vite serve static assets, client modules, and CSS with live HMR
    if (url.pathname.includes('.') && !url.pathname.endsWith('.html')) {
      const res = await new Promise<Response>((resolve) => {
        const reqHeaders = Object.fromEntries(req.headers.entries());
        const nodeReq = {
          url: url.pathname + url.search,
          originalUrl: url.pathname + url.search,
          method: req.method,
          headers: reqHeaders,
        } as unknown as IncomingMessage;

        let statusCode = 200;
        const resHeaders: Record<string, string> = {};

        const nodeRes = {
          statusCode: 200,
          headers: resHeaders,
          getHeader(k: string) {
            return resHeaders[k.toLowerCase()];
          },
          setHeader(k: string, v: string) {
            resHeaders[k.toLowerCase()] = v;
          },
          writeHead(code: number, headers?: Record<string, string>) {
            statusCode = code;
            if (headers) Object.assign(resHeaders, headers);
          },
          end(chunk?: string | Buffer) {
            resolve(
              new Response(chunk ?? '', {
                status: statusCode,
                headers: resHeaders,
              }),
            );
          },
        } as unknown as ServerResponse;

        vite.middlewares(nodeReq, nodeRes, () => {
          resolve(new Response('Not Found', { status: 404 }));
        });
      });

      if (res.status !== 404) return res;
    }

    // 3. Load universal root component via Vite SSR loader with HMR
    const mod = await vite.ssrLoadModule('./SsrApp.tsx');
    const SsrAppApp = mod.SsrAppApp as (id: string, parent: null) => unknown;

    const useMarkers = url.searchParams.get('markers') !== 'false';
    const isStream = url.searchParams.get('stream') === 'true';
    const serverFetch = createMockFetch(req.url);

    // 4. HTTP Chunked Streaming mode (Phase 6)
    if (isStream) {
      const stream = renderToReadableStream(SsrAppApp, {
        url: req.url,
        fetch: serverFetch,
        markers: useMarkers,
      });

      const encoder = new TextEncoder();
      const template = readFileSync(join(dir, 'index.html'), 'utf8');
      const [headPart, tailPart] = template.split('<div id="root"></div>');

      const transformedHead = await vite.transformIndexHtml(req.url, (headPart ?? '') + '<div id="root">');
      const transformedTail = await vite.transformIndexHtml(req.url, '</div>' + (tailPart ?? ''));

      const combinedStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(transformedHead));
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.enqueue(encoder.encode(transformedTail));
          controller.close();
        },
      });

      return new Response(combinedStream, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'transfer-encoding': 'chunked',
        },
      });
    }

    // 5. Standard buffered SSR mode with Vite HTML transformation
    const template = readFileSync(join(dir, 'index.html'), 'utf8');
    const transformedTemplate = await vite.transformIndexHtml(req.url, template);

    const result = await renderToResultAsync(SsrAppApp, {
      url: req.url,
      fetch: serverFetch,
      markers: useMarkers,
      mode: 'resolve',
    });

    const fullHtml = transformedTemplate.replace(
      '<div id="root"></div>',
      `<div id="root">${result.html}</div>${result.scriptTag}`,
    );

    return new Response(fullHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  },
});

import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToReadableStream } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'ssr-streaming.compiled.ts');

const modules = {
  './streaming.tsx': `
    import { $fetch, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';

    function Skeleton() {
      return <div class="skeleton">Loading stream...</div>;
    }

    function ErrorView({ error, retry }: { error: { message: string }; retry: () => void }) {
      return <div class="error">{error.message}</div>;
    }

    export function App() {
      const user = $fetch('/api/user');
      return (
        <main class="streaming-root">
          <Group data={user}>
            <Pending component={Skeleton} />
            <ErrorArm component={ErrorView} />
            <h1>{user.name}</h1>
          </Group>
        </main>
      );
    }
  `,
};

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
const compiled = compileModules(modules, {});
writeFileSync(output, compiled['./streaming.tsx']!);

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function mockDelayedFetch(data: unknown, delayMs = 15): typeof fetch {
  return (() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, delayMs);
    return promise.then(() =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;
}

describe('SSR Phase 6: HTTP Chunked Streaming (renderToReadableStream)', () => {
  it('emits initial shell chunk immediately and state envelope upon completion', async () => {
    const app = await importCompiled();
    const fetch = mockDelayedFetch({ name: 'Ada Lovelace' }, 10);

    const stream = renderToReadableStream(app.App, {
      fetch,
      markers: true,
    });

    expect(stream).toBeInstanceOf(ReadableStream);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Chunk 1: Initial shell HTML
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const initialShell = chunks[0]!;
    expect(initialShell).toContain('<!--mmd:r:App-->');
    expect(initialShell).toContain('class="streaming-root"');

    // Chunk 2: Companion state envelope
    const finalChunk = chunks[chunks.length - 1]!;
    expect(finalChunk).toContain('<script type="application/mmd+json" data-mmd-root="App">');
    expect(finalChunk).toContain('Ada Lovelace');
  });

  it('supports abort signal to cancel in-flight streaming', async () => {
    const app = await importCompiled();
    const controller = new AbortController();
    const fetch = mockDelayedFetch({ name: 'Ada' }, 500);

    const stream = renderToReadableStream(app.App, {
      fetch,
      signal: controller.signal,
    });

    const reader = stream.getReader();
    // Read the initial shell chunk
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Abort while waiting for async resolution
    controller.abort(new Error('client connection closed'));

    // Subsequent read rejects with the abort reason
    await expect(reader.read()).rejects.toThrow('client connection closed');
  });
});

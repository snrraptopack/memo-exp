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
          <Group>
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

function controlledFetch(data: unknown): {
  fetch: typeof fetch;
  resolve: () => void;
} {
  const gate = Promise.withResolvers<void>();
  const fetch = (() =>
    gate.promise.then(() =>
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )) as unknown as typeof globalThis.fetch;
  return { fetch, resolve: gate.resolve };
}

async function readChunks(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(decoder.decode(value));
  }
}

describe('SSR ordered streaming', () => {
  it('emits pending HTML immediately in explicit shell mode', async () => {
    const app = await importCompiled();
    const request = controlledFetch({ name: 'Ada Lovelace' });

    const chunks = await readChunks(renderToReadableStream(app.App, {
      fetch: request.fetch,
      markers: true,
      mode: 'shell',
    }));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('class="skeleton"');
    expect(chunks[0]).not.toContain('Ada Lovelace');
    expect(chunks[1]).toContain('"status":"pending"');
  });

  it('waits for data and emits resolved HTML before the state envelope', async () => {
    const app = await importCompiled();
    const request = controlledFetch({ name: 'Ada Lovelace' });
    const stream = renderToReadableStream(app.App, {
      fetch: request.fetch,
      markers: true,
      mode: 'resolve',
    });

    request.resolve();
    const chunks = await readChunks(stream);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('<!--mmd:r:App-->');
    expect(chunks[0]).toContain('Ada Lovelace');
    expect(chunks[0]).not.toContain('class="skeleton"');
    expect(chunks[1]).toContain(
      '<script type="application/mmd+json" data-mmd-root="App">',
    );
    expect(chunks[1]).toContain('Ada Lovelace');
  });

  it('rejects the stream and aborts request-owned work', async () => {
    const app = await importCompiled();
    const request = controlledFetch({ name: 'Ada' });
    const abort = new AbortController();
    const reader = renderToReadableStream(app.App, {
      fetch: request.fetch,
      signal: abort.signal,
      mode: 'resolve',
    }).getReader();

    abort.abort(new Error('client connection closed'));

    await expect(reader.read()).rejects.toThrow('client connection closed');
  });
});

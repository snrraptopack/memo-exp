import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToString, renderToStringAsync } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'ssr-settle.compiled.ts');

const modules = {
  './app.tsx': `
    import { $fetch, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';

    function Skeleton() {
      return <div class="skeleton">Loading...</div>;
    }

    function ErrorView({ error, retry }: { error: { message: string }; retry: () => void }) {
      return <div class="error">{error.message}</div>;
    }

    export function App() {
      const user = $fetch('/api/user');
      return (
        <section>
          <Group data={user}>
            <Pending component={Skeleton} />
            <ErrorArm component={ErrorView} />
            <h1>{user.name}</h1>
          </Group>
        </section>
      );
    }
  `,
};

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
const compiled = compileModules(modules, {});
writeFileSync(output, compiled['./app.tsx']!);

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function mockFetch(data: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      }),
    )) as typeof fetch;
}

describe('SSR Settle Coordinator (RFC §16.5)', () => {
  it('shell mode renders synchronously with pending fallback skeleton', async () => {
    const app = await importCompiled();
    const fetch = mockFetch({ name: 'Ada' });

    const html = renderToString(app.App, {
      mode: 'shell',
      fetch,
      markers: true,
    });

    expect(html).toContain('class="skeleton"');
    expect(html).not.toContain('Ada');
  });

  it('resolve mode settles in-flight resources and renders resolved content', async () => {
    const app = await importCompiled();
    const fetch = mockFetch({ name: 'Ada Lovelace' });

    const html = await renderToStringAsync(app.App, {
      mode: 'resolve',
      fetch,
      markers: true,
    });

    expect(html).toContain('Ada Lovelace');
    expect(html).not.toContain('class="skeleton"');
  });
});

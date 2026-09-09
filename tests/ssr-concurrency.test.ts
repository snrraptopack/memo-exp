import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToResultAsync, createPayloadScriptTag } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'ssr-concurrency.compiled.ts');

const modules = {
  './concurrency.tsx': `
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
          <Group>
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
writeFileSync(output, compiled['./concurrency.tsx']!);

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

describe('SSR Phase 5: High-Concurrency & Request Isolation (ssr-proposal.md §Phase 5)', () => {
  it('handles 100 concurrent asynchronous renders with unique request data and URLs without cross-contamination', async () => {
    const app = await importCompiled();

    const TOTAL_REQUESTS = 100;
    const tasks = Array.from({ length: TOTAL_REQUESTS }, async (_, i) => {
      const uniqueName = `User_${i}_${Math.random().toString(36).slice(2, 7)}`;
      const uniqueUrl = `/users/${i}`;

      const mockFetch: typeof globalThis.fetch = (() => {
        const latency = Math.floor(Math.random() * 15);
        if (latency > 0) {
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, latency);
          return promise.then(() =>
            new Response(
              JSON.stringify({ id: i, name: uniqueName }),
              {
                headers: { 'content-type': 'application/json' },
                status: 200,
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: i, name: uniqueName }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200,
            },
          ),
        );
      }) as unknown as typeof globalThis.fetch;

      const result = await renderToResultAsync(app.App, {
        url: uniqueUrl,
        fetch: mockFetch,
        markers: true,
        mode: 'resolve',
      });

      return {
        index: i,
        expectedName: uniqueName,
        html: result.html,
        payload: result.payload,
        scriptTag: result.scriptTag,
      };
    });

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(TOTAL_REQUESTS);

    for (const res of results) {
      // 1. Verify HTML contains exact request data and no other request's data
      expect(res.html, JSON.stringify({
        index: res.index,
        payload: res.payload,
      })).toContain(res.expectedName);
      expect(res.html).not.toContain('class="skeleton"');
      expect(res.html).toContain('<!--mmd:r:App-->');

      // 2. Verify state payload matches exact request data
      expect(res.payload.state).toBeDefined();
      expect(res.payload.state?.sources[0]?.snapshot?.data).toEqual({
        id: res.index,
        name: res.expectedName,
      });

      // 3. Verify script tag is properly sanitized
      expect(res.scriptTag).toContain(res.expectedName);
      expect(res.scriptTag).toContain('<script type="application/mmd+json"');
    }
  });

  it('escapes adversarial payloads containing </script> and XSS injection vectors', () => {
    const adversarialPayload = {
      version: 1 as const,
      state: {
        sources: [
          {
            id: 'xss',
            status: 'resolved' as const,
            data: {
              bio: '</script><script>alert("pwned")</script>',
              raw: '<img src=x onerror=alert(1)>',
            },
          },
        ],
      },
    };

    const tag = createPayloadScriptTag('App', adversarialPayload);

    // Raw script terminator MUST NOT appear in the script body
    expect(tag).not.toContain('</script><script>');
    expect(tag).toContain('\\u003c/script\\u003e');
    expect(tag).toContain('\\u003cimg src=x onerror=alert(1)\\u003e');

    // Deserializing via JSON.parse reproduces the exact original data
    const extractedJson = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    const restored = JSON.parse(extractedJson);
    expect(restored.state.sources[0].data.bio).toBe('</script><script>alert("pwned")</script>');
  });
});

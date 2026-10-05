import { resolve } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { RouteRuntime } from '../packages/router/src/runtime';

describe('bundled public router construction', () => {
  for (const graph of ['source', 'package'] as const) {
    it(`retains lazy preparation and failure recovery through the ${graph} constructor alone`, async () => {
      const result = await build({
        stdin: { contents: `export {createRouteRuntime} from '@memoized-dom/router';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router': resolve(import.meta.dirname, '../packages/router/src/index.ts'),
        } : undefined,
        bundle: true, write: false, platform: 'browser', format: 'iife',
        globalName: 'RouterConstructor', minify: true,
      });
      const api = new Function(`${result.outputFiles[0]!.text};return RouterConstructor;`)() as {
        createRouteRuntime: (options: unknown) => RouteRuntime;
      };
      const loader = vi.fn(async () => { throw new Error('chunk unavailable'); });
      const runtime = api.createRouteRuntime({
        environment: { location: { href: 'http://localhost/' } },
        routes: [
          { id: 'home', pattern: '/' },
          { id: 'detail', pattern: '/detail', metadata: {
            componentKey: `bundled-${graph}`, moduleLoader: loader,
          } },
          { id: 'about', pattern: '/about' },
        ],
      });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = runtime.navigate('/detail');
          if (result.status !== 'preparing') throw new Error('Lazy navigation committed prematurely');
          await expect(result.finished).rejects.toThrow('chunk unavailable');
          expect(runtime.route.pathname).toBe('/');
        }
        expect(loader).toHaveBeenCalledTimes(2);
        expect(runtime.navigate('/about').status).toBe('completed');
        expect(runtime.route.pathname).toBe('/about');
      } finally { runtime.dispose(); }
    });
  }
});

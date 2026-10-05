import { resolve } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { DataRuntime } from '../packages/data/src/types';

describe('bundled public data construction', () => {
  for (const graph of ['source', 'package'] as const) {
    it(`retains shared update and mutate through the ${graph} constructor alone`, async () => {
      const result = await build({
        stdin: { contents: `export {createDataRuntime} from '@memoized-dom/data';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/data': resolve(import.meta.dirname, '../packages/data/src/index.ts'),
        } : undefined,
        bundle: true, write: false, platform: 'browser', format: 'iife',
        globalName: 'DataConstructor', minify: true,
      });
      const api = new Function(`${result.outputFiles[0]!.text};return DataConstructor;`)() as {
        createDataRuntime: (options: unknown) => DataRuntime;
      };
      const runtime = api.createDataRuntime({ fetch: async () => new Response(JSON.stringify({ name: 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      }) });
      const first = runtime.$fetch<{ name: string }>('/person');
      const second = runtime.$fetch<{ name: string }>('/person');
      try {
        expect(await runtime.settle()).toBe(true);
        expect(first.data).toEqual({ name: 'Ada' });
        first.update(() => ({ name: 'Grace' }));
        expect(second.data).toEqual({ name: 'Grace' });
        second.mutate(person => { person!.name = 'Lin'; });
        expect(first.data).toBe(second.data);
        expect(first.data).toEqual({ name: 'Lin' });
      } finally { runtime.clear(); }
    });
  }
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import {
  createDataRuntime,
  setActiveDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import { unregister } from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'transparent-destructuring.compiled.ts');
const compiledSpecifier = './fixtures/out/transparent-destructuring.compiled.ts';
let previousRuntime: DataRuntime | null = null;
let runtime: DataRuntime | null = null;
let resolveRequest: ((response: Response) => void) | null = null;

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    output,
    compile(
      readFileSync(join(here, 'fixtures', 'transparent-destructuring.tsx'), 'utf8'),
      { runtimePath: '@memoized-dom/runtime' },
    ),
  );
});

afterEach(() => {
  unregister('TransparentDestructuring');
  document.body.replaceChildren();
  runtime?.clear();
  if (previousRuntime !== null) setActiveDataRuntime(previousRuntime);
  previousRuntime = null;
  runtime = null;
  resolveRequest = null;
});

describe('transparent source destructuring', () => {
  it('keeps aliases, nested fields, arrays, rest, and defaults live', async () => {
    runtime = createDataRuntime({
      baseURL: 'https://example.test/',
      fetch: () => new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    });
    previousRuntime = setActiveDataRuntime(runtime);
    const { App } = await import(compiledSpecifier);
    document.body.appendChild(App('TransparentDestructuring', null, []));

    expect(document.querySelector('#name')?.textContent).toBe('');
    resolveRequest!(new Response(JSON.stringify({
      name: 'Ada',
      address: { city: 'London' },
      tags: ['compiler', 'runtime', 'tests'],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await vi.waitFor(() => {
      expect(document.querySelector('#name')?.textContent).toBe('Ada');
    });
    expect(document.querySelector('#city')?.textContent).toBe('London');
    expect(document.querySelector('#first-tag')?.textContent).toBe('compiler');
    expect(document.querySelector('#other-tags')?.textContent).toBe('runtime,tests');
    expect(document.querySelector('#missing')?.textContent).toBe('fallback');

    document.querySelector('button')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#name')?.textContent).toBe('Grace');
    });
  });
});

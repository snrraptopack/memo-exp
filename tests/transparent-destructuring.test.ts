import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const directOutput = join(outDir, 'direct-source-destructuring.compiled.ts');
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
  writeFileSync(directOutput, compile(`import {$fetch} from '@memoized-dom/data';
    export function App(){let n=0;const {name,missing='fallback'}=$fetch('/profile');
      return <main><p>{name}:{missing}</p><button onClick={()=>n++}>{n}</button></main>;}`,
    {runtimePath:'@memoized-dom/runtime'}));
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
  it('keeps direct source projections live without repeating their request on a local update', async () => {
    const fetch = vi.fn(() => new Promise<Response>(resolve => { resolveRequest = resolve; }));
    runtime = createDataRuntime({baseURL:'https://example.test/',fetch});
    previousRuntime = setActiveDataRuntime(runtime);
    const {App} = await import(/* @vite-ignore */ pathToFileURL(directOutput).href);
    document.body.appendChild(App('TransparentDestructuring',null,[]));
    expect(document.body.textContent).not.toContain('Ada');
    resolveRequest!(new Response(JSON.stringify({name:'Ada'}), {
      status:200,headers:{'content-type':'application/json'},
    }));
    await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Ada:fallback'));
    const original = document.querySelector('p');
    document.querySelector('button')!.click();
    await vi.waitFor(() => expect(document.querySelector('button')?.textContent).toBe('1'));
    expect(document.querySelector('p')).toBe(original);
    expect(original?.textContent).toBe('Ada:fallback');
    expect(fetch).toHaveBeenCalledOnce();
  });

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

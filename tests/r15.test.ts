/**
 * R15 cross-module linking:
 * - state identities are module-qualified after import resolution
 * - same-named exports from different files never share routing
 * - imported store mutation and exported mutator functions both commit
 * - unresolved external calls fall back to the root subtree
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { compileModules } from '@memoized-dom/compiler';
import { resetAccessTable, resolveWrites } from '@memoized-dom/runtime/testing';
import {
  _internals,
  registeredIds,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.ts`;
  return import(specifier);
}

const MODULES = {
  './r15-state-a.ts': `
    export let count = 0;
    export const doubled = count * 2;
    export function inc() { count++; }
    export function reset() { count = 0; }
  `,
  './r15-state-b.ts': `
    export let count = 0;
    export function inc() { count++; }
    export function reset() { count = 0; }
  `,
  './r15-store.ts': `
    export const store = { value: 0 };
    export function reset() { store.value = 0; }
  `,
  './r15-app.tsx': `
    import { count as aCount, doubled as aDoubled, inc as incA } from './r15-state-a';
    import { count as bCount, inc as incB } from './r15-state-b';
    import { store } from './r15-store';

    function A() {
      return <button id="a" onClick={() => incA()}>{aCount}</button>;
    }
    function B() {
      return <button id="b" onClick={() => incB()}>{bCount}</button>;
    }
    function Double() {
      return <output id="double">{aDoubled}</output>;
    }
    function Store() {
      return <button id="store" onClick={() => store.value++}>{store.value}</button>;
    }
    export function App() {
      return <main><A /><B /><Double /><Store /></main>;
    }
  `,
};

describe('R15 - cross-module code generation', () => {
  it('rejects unlinked value imports instead of silently compiling stale UI', () => {
    expect(() =>
      compile(`
        import { store } from './state';
        export function App() { return <p>{store.count}</p>; }
      `),
    ).toThrowError(/requires compileModules/);
  });

  it('qualifies same-named state by its defining module', () => {
    const output = compileModules(MODULES, { runtimePath: '@memoized-dom/runtime' });
    const app = output['./r15-app.tsx']!;

    expect(app).toContain('"./r15-state-a.ts#count"');
    expect(app).toContain('"./r15-state-b.ts#count"');
    expect(app).toContain('"./r15-store.ts#store.value"');
    expect(app).not.toContain('\n    "count":');
  });

  it('rejects rebinding an imported let with an actionable error', () => {
    expect(() =>
      compileModules({
        './state.ts': `export let count = 0;`,
        './app.tsx': `
          import { count } from './state';
          export function App() {
            return <button onClick={() => count++}>{count}</button>;
          }
        `,
      }),
    ).toThrowError(/cannot update imported state 'count'/);
  });

  it('resolves Vite-style aliases without rewriting @ as a relative path', () => {
    const output = compileModules(
      {
        './src/state.ts': `export const store = { count: 0 };`,
        './src/app.tsx': `
          import { store } from '@/state';
          export function App() {
            return <button onClick={() => store.count++}>{store.count}</button>;
          }
        `,
      },
      { aliases: { '@': './src' } },
    );
    expect(output['./src/app.tsx']).toContain('"./src/state.ts#store.count"');
    expect(output['./src/app.tsx']).not.toContain('./@/');
  });

  it('propagates mutator summaries through an imported helper chain', () => {
    const output = compileModules({
      './state.ts': `
        export let count = 0;
        export function inc() { count++; }
      `,
      './actions.ts': `
        import { inc } from './state';
        export function incTwice() { inc(); inc(); }
      `,
      './app.tsx': `
        import { count } from './state';
        import { incTwice } from './actions';
        export function App() {
          return <button onClick={() => incTwice()}>{count}</button>;
        }
      `,
    });
    expect(output['./app.tsx']).toContain('["./state.ts#count"]');
    expect(output['./app.tsx']).not.toContain('MD.markDirtySubtree');
  });

  it('makes unresolved imported calls conservatively unbounded', () => {
    const output = compileModules({
      './app.tsx': `
        import { mutate } from 'third-party';
        export function App() {
          return <button onClick={() => mutate()}>go</button>;
        }
      `,
    });
    expect(output['./app.tsx']).toContain('MD.markDirtySubtree("App")');
  });
});

describe('R15 - cross-module execution', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(MODULES, { runtimePath: '@memoized-dom/runtime' });
    for (const [id, code] of Object.entries(output)) {
      const file = id.endsWith('.tsx') ? `${id.slice(2, -4)}.ts` : id.slice(2);
      writeFileSync(join(outDir, file), code);
    }
  });

  beforeEach(async () => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());

    const a = await importCompiled('r15-state-a');
    const b = await importCompiled('r15-state-b');
    const store = await importCompiled('r15-store');
    a.reset();
    b.reset();
    store.reset();
  });

  afterEach(() => {
    resetScheduler();
  });

  it('routes each imported write only to readers of that canonical export', async () => {
    const { App } = await importCompiled('r15-app');
    document.body.appendChild(App('App', null));

    expect(resolveWrites(['./r15-state-a.ts#count'], registeredIds()).sort()).toEqual(
      [
        'App/A',
        `App/$computed/${encodeURIComponent('./r15-state-a.ts')}#doubled`,
      ].sort(),
    );
    expect(resolveWrites(['./r15-state-b.ts#count'], registeredIds())).toEqual(['App/B']);
    expect(resolveWrites(['./r15-store.ts#store.value'], registeredIds())).toEqual([
      'App/Store',
    ]);

    const a = document.querySelector<HTMLButtonElement>('#a')!;
    const b = document.querySelector<HTMLButtonElement>('#b')!;
    const doubled = document.querySelector<HTMLOutputElement>('#double')!;
    const store = document.querySelector<HTMLButtonElement>('#store')!;
    a.click();
    expect([a.textContent, b.textContent, doubled.textContent, store.textContent]).toEqual([
      '1',
      '0',
      '2',
      '0',
    ]);
    b.click();
    store.click();
    expect([a.textContent, b.textContent, doubled.textContent, store.textContent]).toEqual([
      '1',
      '1',
      '2',
      '1',
    ]);
  });
});

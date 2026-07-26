/**
 * R19 verifies receiver-bounded call effects without method-name semantics.
 * It covers sibling routing, memoized false positives, helper parameters,
 * module arrows, nested store paths, and keyed-row boundaries.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile } from '@memoized-dom/compiler';
import { compileModules } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const source = `
  const values = [1];
  values.refresh = () => {
    values.push(values.length + 1);
  };

  export function resetState() {
    values.length = 1;
  }

  function Controls() {
    return <nav>
      <button id="pure" onClick={() => values.filter(Boolean)}>pure</button>
      <button id="custom" onClick={() => values.refresh()}>custom</button>
    </nav>;
  }

  function Values() {
    return <output id="values">{values.length}</output>;
  }

  function Unrelated() {
    return <aside>fixed</aside>;
  }

  export function App() {
    return <main><Controls /><Values /><Unrelated /></main>;
  }
`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r19-bounded.compiled.ts';
  return import(specifier);
}

function spyRenders(id: string): () => number {
  const entity = _internals().registry.get(id)!;
  const original = entity.render;
  let renders = 0;
  entity.render = () => {
    renders++;
    original();
  };
  return () => renders;
}

describe('R19 - receiver-bounded execution', () => {
  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r19-bounded.compiled.ts'),
      compile(source, { runtimePath: '@memoized-dom/runtime' }),
    );
    resetAccessTable();
    await importCompiled();
  });

  beforeEach(async () => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((fn) => fn());
    const mod = await importCompiled();
    mod.resetState();
    document.body.appendChild(mod.App('App', null));
  });

  afterEach(() => {
    resetScheduler();
  });

  afterAll(() => {
    resetAccessTable();
  });

  it('routes a pure method false positive only to receiver readers', () => {
    const valuesRenders = spyRenders('App/Values');
    const unrelatedRenders = spyRenders('App/Unrelated');

    document.querySelector<HTMLButtonElement>('#pure')!.click();

    expect(document.querySelector('#values')!.textContent).toBe('1');
    expect(valuesRenders()).toBe(1);
    expect(unrelatedRenders()).toBe(0);
  });

  it('reflects an arbitrary overridden method in a sibling reader', () => {
    document.querySelector<HTMLButtonElement>('#custom')!.click();
    expect(document.querySelector('#values')!.textContent).toBe('2');
  });
});

describe('R19 - receiver-bounded code generation', () => {
  it('uses the same bounded write for built-in method names', () => {
    const code = compile(`
      const items = [1];
      function App() {
        return <main>
          <button onClick={() => items.push(2)}>push</button>
          <button onClick={() => items.filter(Boolean)}>filter</button>
          <output>{items.length}</output>
        </main>;
      }
    `);
    expect(code.match(/const _WRITES_\d*/g)).toHaveLength(1);
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(2);
    expect(code).not.toContain('markDirtySubtree');
  });

  it('preserves visible helper parameter paths', () => {
    const code = compile(`
      const store = { value: 0, other: 0 };
      function mutate(target) { target.value++; }
      function App() {
        return <button onClick={() => mutate(store)}>{store.value}</button>;
      }
    `);
    expect(code).toContain('["./component.tsx#store.value"]');
    expect(code).not.toContain(
      '["./component.tsx#store", "./component.tsx#store.value"]',
    );
    expect(code).not.toContain('markDirtySubtree');
  });

  it('composes parameter paths through visible helper chains', () => {
    const code = compile(`
      const store = { nested: { value: 0 }, other: 0 };
      function patch(target) {
        Object.assign(target, { value: target.value + 1 });
      }
      function apply(target) { patch(target.nested); }
      function App() {
        return <button onClick={() => apply(store)}>{store.nested.value}</button>;
      }
    `);
    expect(code).toContain('["./component.tsx#store.nested.value"]');
    expect(code).not.toContain('markDirtySubtree');
  });

  it('rejects receiver calls that could mutate a local derivation', () => {
    expect(() =>
      compile(`
        function App() {
          let items = [1];
          const visible = items.filter(Boolean);
          return <button onClick={() => visible.custom()}>{visible.length}</button>;
        }
      `),
    ).toThrowError(/cannot mutate per-instance derivation 'visible'/);
  });

  it('summarizes module arrow helpers and links parameter effects', () => {
    const output = compileModules({
      './effects.ts': `
        export const inspect = (target) => target.filter(Boolean);
      `,
      './state.ts': `
        export const items = [1];
      `,
      './app.tsx': `
        import { inspect } from './effects';
        import { items } from './state';
        export function App() {
          return <button onClick={() => inspect(items)}>{items.length}</button>;
        }
      `,
    });
    expect(output['./app.tsx']).toContain('["./state.ts#items"]');
    expect(output['./app.tsx']).not.toContain('markDirtySubtree');
  });

  it('table-routes a module arrow used directly as a handler', () => {
    const code = compile(`
      const items = [1];
      const inspect = () => items.filter(Boolean);
      function App() {
        return <button onClick={inspect}>{items.length}</button>;
      }
    `);
    expect(code).toMatch(
      /const inspect = \(\) => \{\s+items\.filter\(Boolean\);\s+_MD\d*\.commitWrites/,
    );
    expect(code).not.toMatch(/markDirty\(_id\d*\)/);
  });

  it('bounds nested receivers and unknown direct-call root arguments', () => {
    const code = compile(`
      const store = { items: [1] };
      const other = [2];
      function App() {
        return <main>
          <button onClick={() => store.items.custom()}>nested</button>
          <button onClick={() => inspect(other)}>unknown</button>
          <output>{store.items.length + other.length}</output>
        </main>;
      }
    `);
    expect(code).toContain('["./component.tsx#store.items"]');
    expect(code).toContain('["./component.tsx#other"]');
    expect(code).not.toContain('markDirtySubtree');
  });

  it('reconciles item receivers that may change a row key', () => {
    const code = compile(`
      const rows = [{ id: 1, refresh() { this.id++; } }];
      function App() {
        return <ul>{rows.map(row =>
          <li key={row.id} onClick={() => row.refresh()}>{row.id}</li>
        )}</ul>;
      }
    `);
    expect(code).toMatch(/row\.refresh\(\);\s+_MD\d*\.commitWrites\(_WRITES_\d*\)/);
    expect(code).toContain('["./component.tsx#rows"]');
  });
});

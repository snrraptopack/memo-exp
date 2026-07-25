/**
 * R17 proves conservative mutation correctness for aliases, reflective
 * writes, unknown callees, mutable aliases, and destructured references.
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
import { compile } from '../compiler/compile';
import { resetAccessTable } from '../src/access';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '../src/kernel';

const source = `
  const items = [];
  const store = { value: 0, removable: 'present', nested: { value: 0 } };

  function mutateUnknown(target) {
    target.value += 1;
  }

  export function resetState() {
    items.length = 0;
    store.value = 0;
    store.removable = 'present';
    store.nested.value = 0;
  }

  export function App() {
    return <main>
      <button id="alias" onClick={() => {
        const alias = items;
        alias.push(items.length);
      }}>alias</button>
      <button id="assign-static" onClick={() => {
        Object.assign(store, { value: store.value + 1 });
      }}>assign static</button>
      <button id="alias-mutable" onClick={() => {
        let alias = items;
        alias.push(items.length);
      }}>mutable alias</button>
      <button id="alias-reassigned" onClick={() => {
        let alias = [];
        alias = items;
        alias.push(items.length);
      }}>reassigned alias</button>
      <button id="destructure" onClick={() => {
        const { nested } = store;
        nested.value += 1;
      }}>destructure</button>
      <button id="assign-dynamic" onClick={() => {
        const patch = { value: store.value + 1 };
        Object.assign(store, patch);
      }}>assign dynamic</button>
      <button id="unknown" onClick={() => mutateUnknown(store)}>unknown</button>
      <button id="delete" onClick={() => delete store.removable}>delete</button>
      <output id="items">{items.length}</output>
      <output id="value">{store.value}</output>
      <output id="removable">{store.removable ?? 'missing'}</output>
      <output id="nested">{store.nested.value}</output>
    </main>;
  }
`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(): Promise<any> {
  return import('./fixtures/out/r17-opaque.compiled.ts');
}

function button(id: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`#${id}`)!;
}

function output(id: string): string | null {
  return document.querySelector<HTMLOutputElement>(`#${id}`)!.textContent;
}

describe('R17 - opaque mutation correctness', () => {
  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r17-opaque.compiled.ts'),
      compile(source, { runtimePath: '../out-runtime' }),
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

  it('keeps immutable aliases precise', () => {
    button('alias').click();
    expect(output('items')).toBe('1');
  });

  it('keeps mutable aliases sound and falls back after reassignment', () => {
    button('alias-mutable').click();
    expect(output('items')).toBe('1');
    button('alias-reassigned').click();
    expect(output('items')).toBe('2');
  });

  it('falls back for a mutable value extracted by destructuring', () => {
    button('destructure').click();
    expect(output('nested')).toBe('1');
  });

  it('updates through static and dynamic Object.assign sources', () => {
    button('assign-static').click();
    expect(output('value')).toBe('1');
    button('assign-dynamic').click();
    expect(output('value')).toBe('2');
  });

  it('falls back when mutable state escapes to an opaque helper parameter', () => {
    button('unknown').click();
    expect(output('value')).toBe('1');
  });

  it('tracks delete as a write', () => {
    button('delete').click();
    expect(output('removable')).toBe('missing');
  });

  it('emits exact keys where provable and subtree fallback where not', () => {
    const code = compile(source, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/\["[^"]+#items"\]/);
    expect(code).toMatch(/\["[^"]+#store\.value"\]/);
    expect(code).toContain('markDirtySubtree("App")');
  });

});

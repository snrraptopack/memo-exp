/**
 * M5.4 — const collections as reactive state.
 *
 * `const items = [...]` / `const m = new Map()` follow JS semantics: the
 * binding never changes, the CONTENTS do. Mutations (push/set/member writes)
 * route as root-keyed writes; rebinding is a compile error instead of a
 * runtime TypeError. `var` bindings classify as 'let' while we're here.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler/compile';
import {
  unregister,
  setScheduler,
  resetScheduler,
  _internals,
} from '../src/kernel';
import { resetAccessTable } from '../src/access';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('M5.4 — const collections, code generation', () => {
  it('const array mutations emit commits', () => {
    const code = compile(
      `const items = [1, 2];\nfunction C() { return <button onClick={() => { items.push(3); }}>{items.length}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)'); // read only by C → local
  });

  it('const Map mutations emit commits', () => {
    const code = compile(
      `const m = new Map();\nfunction C() { return <button onClick={() => { m.set('a', 1); }}>{m.size}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)');
  });

  it('const arrays work as R7 lists', () => {
    const code = compile(
      `const items = [{ id: 1 }];\nlet sel = 0;\nfunction C() { return <ul>{items.map((i) => <li key={i.id} class={sel === i.id ? 'x' : ''}>{i.id}</li>)}</ul>; }`,
    );
    expect(code).toContain('MD.createListRegion(');
    expect(code).toContain('region0.reconcile(items)');
  });

  it('rebinding a const collection is a compile error, not a runtime TypeError', () => {
    expect(() =>
      compile(
        `const items = [1];\nfunction C() { return <button onClick={() => { items = [2]; }}>x</button>; }`,
      ),
    ).toThrowError(/cannot reassign const collection/);
    expect(() =>
      compile(
        `const items = [1];\nfunction C() { return <button onClick={() => { items++; }}>x</button>; }`,
      ),
    ).toThrowError(/cannot update 'items'/);
  });

  it('var bindings classify as let state', () => {
    const code = compile(
      `var n = 0;\nfunction C() { return <button onClick={() => { n++; }}>{n}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)');
  });

  it('store reassignment is still rejected', () => {
    expect(() =>
      compile(
        `const store = { a: 1 };\nfunction C() { return <button onClick={() => { store = { a: 2 }; }}>x</button>; }`,
      ),
    ).toThrowError(/cannot reassign store/);
  });
});

const SOURCES: Record<string, string> = {
  'm54-constarray': `const items = [1, 2];\nexport function C() { return <button onClick={() => { items.push(3); }}>{items.length}</button>; }`,
  'm54-constlist': `const items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];\nexport function C() { const add = () => { items.push({ id: 3, label: 'three' }); }; return <div><ul>{items.map((i) => <li key={i.id}>{i.label}</li>)}</ul><button onClick={add}>add</button></div>; }`,
};

describe('M5.4 — compiled output runs', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, src] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(src, { runtimePath: '../out-runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('const array: push re-renders', async () => {
    const { C } = await importCompiled('m54-constarray');
    document.body.appendChild(C('App', null));
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('2');
    btn.click();
    expect(btn.textContent).toBe('3');
  });

  it('const array list: renders and grows', async () => {
    const { C } = await importCompiled('m54-constlist');
    document.body.appendChild(C('App', null));
    expect(document.querySelectorAll('li')).toHaveLength(2);
    document.querySelector('button')!.click();
    const lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[2]!.textContent).toBe('three');
  });
});

/**
 * R12 — instance (component-local) state.
 *
 * A `let` declared at the top level of a component body lives in the factory
 * closure of ONE instance. It is readable only by that instance — children
 * receive it exclusively through props (R10 re-push on every parent render),
 * nested rows are resynced by the M5.5 reconcile machinery — so writes need
 * NO access-table routing: the commit is unconditionally `markDirty(id)`.
 *
 *   - two instances of the same component are fully independent
 *   - instance writes emit markDirty(id), never a write-set const
 *   - instance OBJECT field writes commit the same way
 *   - instance state SHADOWS same-named module state in its component
 *   - instance state passed as a prop re-pushes the child (R10)
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

// ---------------------------------------------------------------------
// 1. code generation
// ---------------------------------------------------------------------

describe('R12 — instance state, code generation', () => {
  it('instance writes commit markDirty(id) — no write-set const', () => {
    const code = compile(
      `function Counter() { let n = 0; return <button onClick={() => { n++; }}>{n}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)');
    expect(code).not.toContain('WRITES');
    expect(code).not.toContain('commitWrites');
  });

  it('instance OBJECT field writes commit markDirty(id) too', () => {
    const code = compile(
      `function Form() { let form = { name: '' }; return <button onClick={() => { form.name = 'x'; }}>{form.name}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)');
    expect(code).not.toContain('commitWrites');
  });

  it('instance mutator calls commit markDirty(id)', () => {
    const code = compile(
      `function L() { let list = [1]; return <button onClick={() => { list.push(2); }}>{list.length}</button>; }`,
    );
    expect(code).toContain('MD.markDirty(id)');
  });

  it('instance state shadows same-named module state', () => {
    const code = compile(
      `let n = 0;\nfunction C() { let n = 10; return <button onClick={() => { n++; }}>{n}</button>; }`,
    );
    // the component's n is its own — no table write for module 'n'
    expect(code).toContain('MD.markDirty(id)');
    expect(code).not.toContain('commitWrites');
    // and module 'n' is read by nobody → no table entry for it
    expect(code).not.toContain('"n": [');
  });
});

// ---------------------------------------------------------------------
// 2. compiled output runs
// ---------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  'r12-two': `export function Counter() { let n = 0; return <button onClick={() => { n++; }}>{n}</button>; }\nexport function C() { return <div><Counter /><Counter /></div>; }`,
  'r12-shadow': `let n = 0;\nexport function C() { let n = 10; return <button onClick={() => { n++; }}>{n}</button>; }`,
  'r12-prop': `export function Badge(x) { return <em>{x}</em>; }\nexport function C() { let n = 0; return <div><button onClick={() => { n++; }}>{n}</button><Badge x={n} /></div>; }`,
};

describe('R12 — compiled output runs', () => {
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

  it('two instances are fully independent', async () => {
    const { C } = await importCompiled('r12-two');
    document.body.appendChild(C('App', null));
    const [b1, b2] = document.querySelectorAll('button');
    expect(b1!.textContent).toBe('0');
    expect(b2!.textContent).toBe('0');
    b1!.click();
    b1!.click();
    expect(b1!.textContent).toBe('2'); // first advanced
    expect(b2!.textContent).toBe('0'); // second untouched
    // and only the first entity rendered
    const ids = [..._internals().registry.keys()];
    expect(ids.filter((i) => i.includes('Counter'))).toHaveLength(2);
  });

  it('shadowing: the component sees its own n, module n stays put', async () => {
    const mod = await importCompiled('r12-shadow');
    document.body.appendChild(mod.C('App', null));
    const b = document.querySelector('button')!;
    expect(b.textContent).toBe('10');
    b.click();
    expect(b.textContent).toBe('11'); // instance n advanced
  });

  it('instance state flows to children through the props box', async () => {
    const { C } = await importCompiled('r12-prop');
    document.body.appendChild(C('App', null));
    const b = document.querySelector('button')!;
    const em = document.querySelector('em')!;
    expect(em.textContent).toBe('0');
    b.click();
    b.click();
    expect(b.textContent).toBe('2'); // own text updated
    expect(em.textContent).toBe('2'); // child re-pushed via setProps (R10)
  });
});

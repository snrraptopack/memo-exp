/**
 * R13 — auto-detected computeds (derived state, option B: no wrapper).
 *
 * A module-level `const x = <pure state derivation>` becomes a computed:
 * the declaration is rewritten to a let, and a depth-(-1) entity recomputes
 * it whenever a SOURCE key is written — committing 'x' downstream ONLY when
 * the value safely compares unchanged (Object.is primitives and element-wise
 * equality for distinct primitive arrays). Mutable references propagate
 * conservatively so in-place changes stay live.
 *
 *   - detection: BY REFERENCE — any expression mentioning declared state is
 *     derived (arbitrary calls / new / local-mutating callbacks are fine;
 *     no method whitelist)
 *   - direct proven writes to state (or await) are a COMPILE ERROR
 *   - receiver-method semantics are author-owned; no method-name table
 *   - writes TO a computed are a compile error (write the source)
 *   - chains: a computed may read another computed
 *   - ordering: recompute renders before any reader (depth -1)
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

function spyRenders(id: string): () => number {
  const e = _internals().registry.get(id)!;
  let n = 0;
  const orig = e.render;
  e.render = () => {
    n++;
    orig();
  };
  return () => n;
}

// ---------------------------------------------------------------------
// 1. code generation
// ---------------------------------------------------------------------

describe('R13 — computeds, code generation', () => {
  it('a pure state derivation becomes a depth-(-1) recomputing entity', () => {
    const code = compile(
      `let todos = [{ id: 1, done: false }];\nconst active = todos.filter((t) => !t.done);\nfunction C() { return <ul>{active.map((t) => <li key={t.id}>{t.id}</li>)}</ul>; }`,
    );
    expect(code).toContain('let active =');
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#active"');
    expect(code).toContain('depth: -1');
    expect(code).toMatch(/\.computedChanged\(active, _activeNext\d*\)/);
    expect(code).toMatch(/\.commitWrites\(_WRITES_\d*\)/);
    // the computed reads its source through the table
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#active"');
  });

  it('scalar derivations and chains work', () => {
    const code = compile(
      `let first = 'a';\nlet last = 'b';\nconst full = first + ' ' + last;\nconst shout = full.toUpperCase();\nfunction C() { return <p>{shout}</p>; }`,
    );
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#full"');
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#shout"');
  });

  it('collection literals derived from state take precedence over mutable-collection classification', () => {
    const code = compile(
      `let count = 1;\nconst pair = [count, count + 1];\nfunction C() { return <p>{pair.join(',')}</p>; }`,
    );
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#pair"');
    expect(code).toMatch(/\.computedChanged\(pair, _pairNext\d*\)/);
  });

  it('store-member derivations read the dotted key', () => {
    const code = compile(
      `const store = { items: [1, 2] };\nconst total = store.items.reduce((s, i) => s + i, 0);\nfunction C() { return <p>{total}</p>; }`,
    );
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#total"');
  });

  it('detection is by reference — arbitrary calls, new, and local mutations are allowed', () => {
    // unknown/imported/global functions, new expressions, and callbacks that
    // mutate LOCALS are all fine: a derivation recomputes on every source
    // write and computedChanged gates what propagates (R13.1 — no whitelist)
    const code = compile(
      `let todos = [{ id: 1, done: false }];\n` +
        `const grouped = groupBy(todos, (t) => t.done);\n` + // unknown fn
        `const stamp = new Date(todos.length);\n` + // new expression
        `const ids = todos.reduce((a, t) => { a.push(t.id); return a; }, []);\n` + // local mutation
        `function C() { return <p>{ids.length}</p>; }`,
    );
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#grouped"');
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#stamp"');
    expect(code).toContain('"App/$computed/.%2Fcomponent.tsx#ids"');
  });

  it('derivations reject proven writes without inferring method semantics', () => {
    // assignment to state inside the initializer
    expect(() =>
      compile(
        `let count = 0;\nconst x = (count = 5);\nfunction C() { return <p>{x}</p>; }`,
      ),
    ).toThrowError(/state derivation but contains an assignment/);
    // Method semantics are not inferred from spelling. Authors must keep
    // derivations observationally pure.
    expect(() =>
      compile(
        `let todos = [1, 2];\nconst s = todos.sort((a, b) => a - b);\nfunction C() { return <p>{s}</p>; }`,
      ),
    ).not.toThrow();
    // calling a helper known to write state
    expect(() =>
      compile(
        `let count = 0;\nfunction bump() { count += 1; return count; }\nconst x = bump();\nfunction C() { return <p>{x}</p>; }`,
      ),
    ).toThrowError(/state derivation but calls helper 'bump' which writes state/);
  });

  it('writing a computed is a compile error', () => {
    expect(() =>
      compile(
        `let todos = [1];\nconst active = todos.filter((t) => t);\nfunction C() { return <button onClick={() => { active = []; }}>{active.length}</button>; }`,
      ),
    ).toThrowError(/cannot assign computed 'active'/);
  });

  it('mutating a computed is a compile error', () => {
    expect(() =>
      compile(
        `let todos = [1];\nconst active = todos.filter((t) => t);\nfunction C() { return <button onClick={() => { active.push(2); }}>{active.length}</button>; }`,
      ),
    ).toThrowError(/cannot mutate computed 'active'/);
  });

  it('plain consts (no state reads) stay untouched', () => {
    const code = compile(`const x = 42;\nfunction C() { return <p>{x}</p>; }`);
    expect(code).not.toContain('$computed');
  });
});

// ---------------------------------------------------------------------
// 2. compiled output runs
// ---------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  'r13-parity': `let count = 0;\nexport const parity = count % 2;\nexport function P() { return <em>{parity}</em>; }\nexport function C() { return <div><button onClick={() => { count += 2; }}>+2</button><button onClick={() => { count += 1; }}>+1</button><span>{count}</span></div>; }\nexport function W() { return <section><C /><P /></section>; }`,
  'r13-filter': `let todos = [{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }];\nconst active = todos.filter((t) => !t.done);\nexport function Controls() { return <div><button onClick={() => { todos[0].title = 'a2'; }}>rename</button><button onClick={() => { todos[0].done = true; }}>toggle</button></div>; }\nexport function List() { return <ul>{active.map((t) => <li key={t.id}>{t.title}</li>)}</ul>; }\nexport function W() { return <section><Controls /><List /></section>; }`,
};

describe('R13 — compiled output runs', () => {
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

  it('deep memoization: unchanged derivation → zero downstream renders', async () => {
    const mod = await importCompiled('r13-parity');
    document.body.appendChild(mod.W('App', null));
    const pR = spyRenders('App/P');
    const [plus2, plus1] = document.querySelectorAll('button');
    const em = document.querySelector('em')!;
    const span = document.querySelector('span')!;
    expect(em.textContent).toBe('0');

    plus2!.click(); // count 0→2: parity STAYS 0
    expect(span.textContent).toBe('2'); // count reader updated
    expect(pR()).toBe(0); // parity reader did NOT render
    expect(em.textContent).toBe('0');

    plus1!.click(); // count 2→3: parity flips to 1
    expect(em.textContent).toBe('1');
    expect(pR()).toBe(1); // exactly ONE render (recompute ran first)
  });

  it('array computeds propagate retained object changes and membership changes', async () => {
    const mod = await importCompiled('r13-filter');
    document.body.appendChild(mod.W('App', null));
    expect(document.querySelectorAll('li')).toHaveLength(2);
    const listR = spyRenders('App/List');
    const [renameBtn, toggleBtn] = document.querySelectorAll('button');

    renameBtn!.click(); // same membership, but one retained object's field changed
    expect(document.querySelector('li')!.textContent).toBe('a2');
    expect(listR()).toBe(1);

    toggleBtn!.click(); // membership changes
    expect(listR()).toBe(2);
    expect(document.querySelectorAll('li')).toHaveLength(1);
    expect(document.querySelector('li')!.textContent).toBe('b');
  });
});

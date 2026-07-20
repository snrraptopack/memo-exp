/**
 * M5.3 — silent-miscompile fixes (spec §11.1).
 *
 * Each confirmed defect from the audit gets a codegen test (the compiled
 * output carries the fix) and, where the defect was runtime-visible, an
 * execution test under happy-dom. Sources are inline — these probes are
 * small on purpose.
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
import { installAccessTable, resetAccessTable, resolveWrites } from '../src/access';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

// ---------------------------------------------------------------------
// 1. code generation
// ---------------------------------------------------------------------

describe('M5.3 fixes — code generation', () => {
  it('early return: the commit is inserted before every return of the scope', () => {
    const code = compile(
      `let n = 0;\nfunction C() { return <button onClick={() => { n++; if (n > 5) return; }}>{n}</button>; }`,
    );
    const handler = code.slice(code.indexOf('onclick'));
    expect(handler.indexOf('MD.markDirty(id)')).toBeLessThan(handler.indexOf('return;'));

    // trailing return: commit before it, not dead code after
    const code2 = compile(
      `let n = 0;\nfunction C() { return <button onClick={() => { n++; return; }}>{n}</button>; }`,
    );
    const handler2 = code2.slice(code2.indexOf('onclick'));
    expect(handler2.indexOf('MD.markDirty(id)')).toBeLessThan(handler2.indexOf('return;'));
  });

  it('member-chain mutators commit the static dotted path', () => {
    const code = compile(
      `const store = { items: [1] };\nfunction C() { return <button onClick={() => { store.items.push(2); }}>{store.items.length}</button>; }`,
    );
    // 'store.items' is read only by C → local commit, but it MUST exist
    expect(code).toContain('MD.markDirty(id)');
    // the callee chain is no longer registered as a (bogus) read key
    expect(code).not.toContain('"store.items.push"');
    // and the write path itself IS in the table for the resolver
    expect(code).toContain('"store.items"');
  });

  it('multi-parent components route to every instance', () => {
    const code = compile(
      `let a = 0;\nfunction Child() { return <span>{a}</span>; }\nfunction P1() { return <div><Child /></div>; }\nfunction P2() { return <section><Child /></section>; }\nfunction App() { return <main><P1 /><P2 /></main>; }`,
    );
    expect(code).toContain('"App/P1/Child"');
    expect(code).toContain('"App/P2/Child"');
  });

  it('lists inside repeated children expand the repeated ancestor in row patterns', () => {
    const code = compile(
      `let items = [1, 2];\nlet sel = 0;\nfunction Tag() { return <ul>{items.map((i) => <li key={i} class={sel === i ? 'x' : ''}>{i}</li>)}</ul>; }\nfunction App() { return <div><Tag /><Tag /></div>; }`,
    );
    expect(code).toContain('"App/Tag/items/Row[*]"');
    expect(code).toContain('"App/Tag[*]/items/Row[*]"');
  });

  it('module-level helpers are not components and their writes are tracked', () => {
    const code = compile(
      `let n = 0;\nfunction bump() { n++; }\nfunction C() { return <button onClick={() => { bump(); }}>{n}</button>; }`,
    );
    expect(code).not.toContain('function bump(id, parent)');
    // 'n' is read only by C → local commit, but it MUST exist
    expect(code).toContain('MD.markDirty(id)');

    // helper with a mutator write
    const code2 = compile(
      `let items = [1];\nfunction addIt(x) { items.push(x); }\nfunction C() { return <button onClick={() => { addIt(2); }}>{items.length}</button>; }`,
    );
    expect(code2).toContain('MD.markDirty(id)');
  });

  it('module-level functions referenced as handlers commit through the table', () => {
    const code = compile(
      `let n = 0;\nfunction inc() { n++; }\nfunction C() { return <button onClick={inc}>{n}</button>; }`,
    );
    // no `id` in a module-level scope → commitWrites, never markDirty(id)
    expect(code).toContain('WRITES_0 = ["n"]');
    expect(code).toContain('MD.commitWrites(WRITES_0)');
    expect(code).not.toContain('markDirty(id)');
  });

  it('helper calls in JSX fold their summarized reads into the component', () => {
    const code = compile(
      `let locale = 'en';\nfunction fmt(x) { return locale + ':' + x; }\nfunction C() { return <span>{fmt(1)}</span>; }`,
    );
    expect(code).toContain('"locale"');
  });

  it('falsy literal children emit no text nodes', () => {
    const code = compile(
      `let n = 0;\nfunction C() { return <div>{null}{true}{undefined}{n > 1 ? 'x' : null}</div>; }`,
    );
    expect(code.match(/createTextNode/g)).toHaveLength(1);
  });

  it('rejects the newly-validated misuses with actionable errors', () => {
    // key on a static child (was: silent prop misalignment)
    expect(() =>
      compile(
        `let a = 0;\nfunction Badge() { return <span />; }\nfunction C() { return <div><Badge key="k" /></div>; }`,
      ),
    ).toThrowError(/only meaningful on list rows/);
    expect(() =>
      compile(`function C() { return <div key="k">x</div>; }`),
    ).toThrowError(/only meaningful on list rows/);

    // state-reading props on a static child (was: silently stale)
    expect(() =>
      compile(
        `let a = 0;\nfunction Badge(x) { return <span>{x}</span>; }\nfunction C() { return <div><Badge x={a} /></div>; }`,
      ),
    ).toThrowError(/mount-time/);

    // recursive components (was: infinite factory recursion at runtime)
    expect(() =>
      compile(`function Tree() { return <div><Tree /></div>; }`),
    ).toThrowError(/recursive component/);

    // a component used both statically and as a list row
    expect(() =>
      compile(
        `let items = [1];\nfunction Row() { return <li />; }\nfunction C() { return <div><Row /><ul>{items.map(i => <Row key={i} />)}</ul></div>; }`,
      ),
    ).toThrowError(/both as a list row and as a static child/);
  });
});

// ---------------------------------------------------------------------
// 2. runtime: resolver path-granularity matching
// ---------------------------------------------------------------------

describe('M5.3 fixes — resolver prefix matching', () => {
  beforeEach(() => resetAccessTable());

  it('a write matches readers at equal, descendant, and ancestor paths', () => {
    installAccessTable({ readers: { 'store.items.length': ['App'] } }, 'App');
    expect(resolveWrites(['store.items.length'], ['App'])).toEqual(['App']);
    expect(resolveWrites(['store.items'], ['App'])).toEqual(['App']);
    expect(resolveWrites(['store'], ['App'])).toEqual(['App']);
    // siblings do not match
    expect(resolveWrites(['store.other'], ['App'])).toEqual([]);
  });

  it('matching is segment-wise: items does not match items1', () => {
    installAccessTable({ readers: { items: ['App'] } }, 'App');
    expect(resolveWrites(['items1'], ['App'])).toEqual([]);
    expect(resolveWrites(['items'], ['App'])).toEqual(['App']);
  });
});

// ---------------------------------------------------------------------
// 3. compiled output runs
// ---------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  'm53-mutator': `const store = { items: [1] };\nexport function C() { return <button onClick={() => { store.items.push(2); }}>{store.items.length}</button>; }`,
  'm53-helper': `let n = 0;\nfunction bump() { n++; }\nexport function C() { return <button onClick={() => { bump(); }}>{n}</button>; }`,
  'm53-early': `let n = 0;\nexport function C() { return <button onClick={() => { n += 10; if (n > 5) return; }}>{n}</button>; }`,
  'm53-modhandler': `let n = 0;\nfunction inc() { n++; }\nexport function C() { return <button onClick={inc}>{n}</button>; }`,
};

describe('M5.3 fixes — compiled output runs', () => {
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

  // (these fixtures return a bare <button> — the text lives on the button)
  it('member-chain mutator: click re-renders the length reader', async () => {
    const { C } = await importCompiled('m53-mutator');
    document.body.appendChild(C('App', null));
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('1');
    btn.click();
    expect(btn.textContent).toBe('2');
  });

  it('helper write: click commits through the helper summary', async () => {
    const { C } = await importCompiled('m53-helper');
    document.body.appendChild(C('App', null));
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('0');
    btn.click();
    expect(btn.textContent).toBe('1');
  });

  it('early return: the write commits even on the returned path', async () => {
    const { C } = await importCompiled('m53-early');
    document.body.appendChild(C('App', null));
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('0');
    btn.click();
    expect(btn.textContent).toBe('10');
  });

  it('module-level handler reference: click commits through the table', async () => {
    const { C } = await importCompiled('m53-modhandler');
    document.body.appendChild(C('App', null));
    const btn = document.querySelector('button')!;
    expect(btn.textContent).toBe('0');
    btn.click();
    expect(btn.textContent).toBe('1');
  });
});

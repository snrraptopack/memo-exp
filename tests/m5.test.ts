/**
 * M5 — the compiler.
 *
 * Two layers of proof:
 *   1. Code generation: fixtures compile to the emission form (snapshots +
 *      key fragments), and unsupported constructs fail with actionable errors.
 *   2. Execution: compiled output is written to test/fixtures/out/, imported,
 *      mounted under happy-dom, and driven by real clicks — asserting both
 *      DOM correctness and commit precision through the access table.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import {
  register,
  unregister,
  registeredIds,
  setScheduler,
  resetScheduler,
  _internals,
} from '@memoized-dom/runtime/testing';
import { resolveWrites } from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const outDir = join(fixturesDir, 'out');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, `${name}.tsx`), 'utf8');
}

/**
 * Import a compiled fixture. The specifier is computed at runtime on purpose:
 * a literal dynamic import is resolved by vite at transform time, before
 * beforeAll has written the file.
 */
function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

// ---------------------------------------------------------------------
// 1. code generation
// ---------------------------------------------------------------------

describe('M5 compiler — code generation', () => {
  it('compiles the counter fixture to the emission form', () => {
    const code = compile(readFixture('counter'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    // R1: entity factory + register
    expect(code).toMatch(/function Counter\(_id\d*, _parent\d*\)/);
    expect(code).toContain('.register(');
    // R3/R4 (M5.9 form): inline guarded writes over numbered slot locals
    expect(code).toMatch(/if \(_slot\d* !== \(_value\d* = count\)\)/);
    expect(code).toMatch(/_text\d*\.data =/);
    // R5: module state always commits through its canonical table key.
    expect(code).toMatch(
      /_WRITES_\d* = \["\.\/component\.tsx#again", "\.\/component\.tsx#count"\]/,
    );
    expect(code).toMatch(/\.commitWrites\(_WRITES_\d*\)/);
  });

  it('compiles the shared-state fixture with an access table', () => {
    const code = compile(readFixture('shared'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    // R5: 'name' is read by Badge, written by Editor → hoisted write set
    expect(code).toMatch(/_WRITES_\d* = \["\.\/component\.tsx#name"\]/);
    expect(code).toMatch(/\.commitWrites\(_WRITES_\d*\)/);
    // R6: table routes 'name' to Badge's subtree only
    expect(code).toContain('installAccessTable');
    expect(code).toContain('"App/Badge"');
    // composition: factories receive (childId, parentId)
    expect(code).toMatch(/Badge\(_id\d* \+ "\/Badge", _id\d*\)/);
    expect(code).toMatch(/Editor\(_id\d* \+ "\/Editor", _id\d*\)/);
  });

  it('compiles repeated children with distinct ids and covering patterns', () => {
    const code = compile(readFixture('repeated'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    // second instance gets a bracket-suffixed id and its own variable
    expect(code).toMatch(/_id\d* \+ "\/Tag\[1\]"/);
    // the table covers every instance: exact, bracket wildcard, subtrees
    expect(code).toContain('"App/Tag[*]"');
  });

  it('attributes commits to the scope that writes (async handlers, timers)', () => {
    const code = compile(readFixture('async'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    // Both async write scopes commit the same canonical write set.
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(2);
    // the awaited write commits after the await, inside the async body
    const asyncBody = code.slice(
      code.indexOf('const incLater'),
      code.indexOf('const incTimer'),
    );
    expect(asyncBody.indexOf('await Promise.resolve()')).toBeLessThan(
      asyncBody.indexOf('.commitWrites('),
    );
    // the timer write commits inside the setTimeout callback, not outside it
    const timerCb = code.slice(code.indexOf('setTimeout(() =>'), code.indexOf('}, 0)'));
    expect(timerCb).toContain('count = 10');
    expect(timerCb).toContain('.commitWrites(');
  });

  it('wraps implicit-return callbacks and bounds dynamic store paths to the store', () => {
    // implicit-return arrow in a fire-and-forget chain: the commit is
    // injected without losing the callback's return value
    const chain = compile(
      `let n = 0;\nfunction C() { return <button onClick={() => { Promise.resolve().then(() => n = 5); }}>go</button>; }`,
    );
    expect(chain).toMatch(/const _returnValue\d* =/);
    expect(chain).toMatch(/return _returnValue\d*/);

    // store[k] = v — the path is imprecise but bounded to the store root
    const dyn = compile(
      `const store = { a: 1 };\nfunction C() { return <button onClick={(k) => { store[k] = 2; }}>go</button>; }`,
    );
    expect(dyn).toContain('["./component.tsx#store"]');
    expect(dyn).toContain('.commitWrites(');
    expect(dyn).not.toContain('markDirtySubtree');
    expect(dyn).not.toContain('opaque:');
  });

  it('compiles inline list rows to regions with row-scoped patterns (R7)', () => {
    const code = compile(readFixture('list-inline'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    expect(code).toMatch(/\.createListRegion\(_ul\d*, _id\d* \+ "\/items"/);
    expect(code).toMatch(/_region\d*\.reconcile\(items\)/);
    // rows are multi-instance: the click routes through the table
    expect(code).toMatch(/\.commitWrites\(_WRITES_\d*\)/);
    // 'items.push' is a local write: the owner re-renders and reconciles
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(2);
    // row entities live at the bracket pattern
    expect(code).toContain('"App/items/Row[*]"');
  });

  it('accepts destructured and object props as owner-local list sources (R7/R24)', () => {
    const destructured = compile(`
      function List({ items }) {
        return <ul>{items.map(item =>
          <li key={item.id}>{item.label}</li>
        )}</ul>;
      }
    `);
    expect(destructured).toContain('.reconcile(items)');
    expect(destructured).not.toContain(
      '"./component.tsx#items"',
    );

    const objectProp = compile(`
      function List(props) {
        return <ul>{props.items.map(item =>
          <li key={item.id}>{item.label}</li>
        )}</ul>;
      }
    `);
    expect(objectProp).toContain('.reconcile(props.items)');
    expect(objectProp).not.toContain(
      '"./component.tsx#props.items"',
    );
  });

  it('compiles eligible component list rows as lightweight factories (M5.10)', () => {
    const code = compile(readFixture('list-component'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    expect(code).toMatch(/Row\(item, _rowId\d*, _ul\d*\)/);
    expect(code).toContain('entities: []');
    expect(code).toContain('"App", "App/*"');
  });

  it('rejects unsupported constructs with actionable errors', () => {
    const jsxValue = compile(
      `function C() { const x = 1 > 0 ? <span>a</span> : null; return <div>{x}</div>; }`,
    );
    expect(jsxValue).toContain('.createCondRegion(');

    {
      const code = compile(
        `function C() { const xs = [1]; return <ul>{xs.map(x => <li>{x}</li>)}</ul>; }`,
      );
      expect(code).toContain('createListRegion');
      expect(code).toContain('.reconcile(xs)');
      expect(code).not.toContain('"./component.tsx#xs"');
    }

    const listValue = compile(
      `let xs = [1];\nfunction C() { const rows = xs.map(x => <li>{x}</li>); return <div>{rows}</div>; }`,
    );
    expect(listValue).toContain('.createListRegion(');

    // R10: state-reading row props — allowed, re-pushed on every reconcile
    {
      const code = compile(
        `let s = 0; let items = [1];\nfunction Row(sel) { return <li>{sel}</li>; }\nfunction C() { return <ul>{items.map(i => <Row sel={s} />)}</ul>; }`,
      );
      expect(code).toContain('updateProps');
      expect(code).toMatch(/_entry\d*\.updateProps\(s\)/);
    }

    expect(compile(`function C() { return <><span /></>; }`)).toContain(
      'createDocumentFragment',
    );

    expect(
      compile(`function C() { return <div {...{ a: 1 }} />; }`),
    ).toContain('patchDomProps');

    expect(() =>
      compile(`let s = 0;\nfunction C() { return <button onClick={() => { mystery = 1; }} />; }`),
    ).toThrowError(/'mystery'/);
  });
});

// ---------------------------------------------------------------------
// 2. compiled output runs
// ---------------------------------------------------------------------

describe('M5 compiler — compiled output runs', () => {
  beforeAll(() => {
    // NOTE: do NOT rm the shared out dir here — other suites (m53, m54, …)
    // write their compiled fixtures into it in parallel workers.
    mkdirSync(outDir, { recursive: true });
    for (const name of ['counter', 'shared', 'repeated', 'async', 'list-inline', 'list-component']) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(readFixture(name), { runtimePath: '@memoized-dom/runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((fn) => fn()); // synchronous commit
  });

  afterEach(() => {
    resetScheduler();
  });

  it('counter: mounts, renders, and re-renders itself on click', async () => {
    register({ id: 'App', parent: null, render: () => {} });
    const { Counter } = await importCompiled('counter');
    document.body.appendChild(Counter('App/Counter', 'App'));

    const button = document.querySelector('button')!;
    const span = document.querySelector('span')!;
    expect(document.querySelector('.counter')).not.toBeNull();
    expect(span.textContent).toBe('0');
    expect(button.textContent).toBe('increment');

    button.click();
    expect(span.textContent).toBe('1');
    button.click();
    expect(span.textContent).toBe('2');
    // local commit: the parent root entity must not re-render on clicks
    expect(registeredIds()).toContain('App/Counter');
  });

  it('shared: a write commits only the subtree that reads it', async () => {
    const { App } = await importCompiled('shared');
    document.body.appendChild(App('App', null));

    const badge = document.querySelector('.badge')!;
    const button = document.querySelector('button')!;
    expect(badge.textContent).toBe('Ada');

    // the compiled access table routes 'name' to Badge only
    expect(registeredIds()).toEqual(['App', 'App/Badge', 'App/Editor']);
    expect(resolveWrites(['./component.tsx#name'], registeredIds())).toEqual(['App/Badge']);

    button.click();
    expect(badge.textContent).toBe('Grace');
    // Editor's own static text untouched, tree intact
    expect(button.textContent).toBe('rename');
  });

  it('repeated: one write re-renders every instance of the child', async () => {
    const { App } = await importCompiled('repeated');
    document.body.appendChild(App('App', null));

    const tags = document.querySelectorAll('.tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]!.textContent).toBe('hello');
    expect(tags[1]!.textContent).toBe('hello');

    // the table routes 'label' to BOTH instances
    expect(registeredIds()).toEqual(['App', 'App/Tag', 'App/Tag[1]']);
    expect(resolveWrites(['./component.tsx#label'], registeredIds())).toEqual([
      'App/Tag',
      'App/Tag[1]',
    ]);

    document.querySelector('button')!.click();
    expect(tags[0]!.textContent).toBe('world');
    expect(tags[1]!.textContent).toBe('world');
  });

  it('async: commits fire when writes happen — after awaits, inside timers', async () => {
    register({ id: 'App', parent: null, render: () => {} });
    const { AsyncCounter } = await importCompiled('async');
    document.body.appendChild(AsyncCounter('App/AsyncCounter', 'App'));

    const [asyncBtn, timerBtn] = document.querySelectorAll('button');
    const span = document.querySelector('span')!;
    expect(span.textContent).toBe('0');

    // awaited handler: the write and its commit land in the continuation
    asyncBtn!.click();
    expect(span.textContent).toBe('0'); // still suspended at the await
    await Promise.resolve();
    await Promise.resolve();
    expect(span.textContent).toBe('1');

    // fire-and-forget timer: the commit lives inside the callback
    timerBtn!.click();
    expect(span.textContent).toBe('1'); // timer has not fired yet
    await new Promise((r) => setTimeout(r, 10));
    expect(span.textContent).toBe('10');
  });

  it('list (inline rows): renders, selects and pushes via canonical commits', async () => {
    // the module's root component mounts at rootId — the table's
    // canonical paths are compile-time paths (§4.6)
    const { InlineList } = await importCompiled('list-inline');
    document.body.appendChild(InlineList('App', null));

    let lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(2);
    expect(lis[0]!.textContent).toBe('one');

    // row entities registered at the bracket ids; 'selected' routes to both
    expect(registeredIds()).toEqual([
      'App',
      'App/items/Row[1]',
      'App/items/Row[2]',
    ]);
    expect(resolveWrites(['./component.tsx#selected'], registeredIds())).toEqual([
      'App/items/Row[1]',
      'App/items/Row[2]',
    ]);

    lis[0]!.click();
    expect(lis[0]!.className).toBe('danger');
    expect(lis[1]!.className).toBe('');

    lis[1]!.click();
    expect(lis[0]!.className).toBe('');
    expect(lis[1]!.className).toBe('danger');

    document.querySelector('button')!.click();
    lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[2]!.textContent).toBe('three');
    expect(lis[1]!.className).toBe('danger'); // selection survives reconcile
  });

  it('list (component rows): lightweight factories preserve behavior', async () => {
    const { CompList } = await importCompiled('list-component');
    document.body.appendChild(CompList('App', null));

    let lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(2);

    expect(registeredIds()).toEqual(['App']);
    expect(resolveWrites(['./component.tsx#selected'], registeredIds())).toEqual(['App']);

    lis[0]!.click();
    expect(lis[0]!.className).toBe('danger');
    expect(lis[1]!.className).toBe('');

    document.querySelector('button')!.click();
    lis = document.querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[0]!.className).toBe('danger'); // retained row kept its state
  });
});

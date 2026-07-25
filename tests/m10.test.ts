/**
 * R11 — row-local item writes (parametrized precision without payloads).
 *
 * A handler inside a list row that writes a field of the row's ITEM
 * (todo.done = …) affects ONLY that row's DOM: item data reaches the row
 * through reconcile/props, never through the access table. The compiler
 * knows the row statically, so the commit is a plain markDirty on the row
 * id — no table routing, no wildcard, no sibling renders.
 *
 *   - inline rows:       todo.done = …      → markDirty(rowId)
 *   - component rows:    item.done = …      → markDirty(id)
 *   - key-field writes:  todo.id = …        → source-array write (re-key)
 *   - dynamic item path: todo[k] = …        → source-array write (fallback)
 *   - mixed scopes:      item field + state → BOTH commits, one scope
 *
 * Before R11 these writes were invisible (no commit — stale UI).
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
  const reg = _internals().registry;
  const e = reg.get(id)!;
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

describe('R11 — row-local item writes, code generation', () => {
  it('inline row: item-field write commits markDirty(rowId), no table write', () => {
    const code = compile(
      `let todos = [{ id: 1, done: false }];\nfunction C() { return <ul>{todos.map((todo) => <li key={todo.id} onClick={() => { todo.done = !todo.done; }}>{todo.done ? 'y' : 'n'}</li>)}</ul>; }`,
    );
    expect(code).toContain('MD.markDirty(rowId)');
    // the item write must NOT route through the array's write key
    expect(code).not.toContain('WRITES');
  });

  it('lightweight component row: item-field write calls its local updater', () => {
    const code = compile(
      `let todos = [{ id: 1, done: false }];\nfunction Row(item) { return <li onClick={() => { item.done = !item.done; }}>{item.done ? 'y' : 'n'}</li>; }\nfunction C() { return <ul>{todos.map((todo) => <Row key={todo.id} item={todo} />)}</ul>; }`,
    );
    expect(code).toContain('item.done = !item.done;\n    update();');
    expect(code).not.toContain('MD.markDirty(__memoRowId)');
  });

  it('key-field writes fall back to the source-array write', () => {
    const code = compile(
      `let todos = [{ id: 1 }];\nfunction C() { return <ul>{todos.map((todo) => <li key={todo.id} onClick={() => { todo.id = todo.id + 10; }}>{todo.id}</li>)}</ul>; }`,
    );
    // Structural: route the canonical array write to the owner so reconcile
    // re-keys; never dirty only the old row id.
    expect(code).toContain('MD.commitWrites(WRITES_0)');
    expect(code).not.toContain('MD.markDirty(rowId)');
  });

  it('dynamic item paths fall back to the source-array write', () => {
    const code = compile(
      `let todos = [{ id: 1 }];\nfunction C() { return <ul>{todos.map((todo) => <li key={todo.id} onClick={() => { const k = 'id'; todo[k] = 2; }}>{todo.id}</li>)}</ul>; }`,
    );
    expect(code).toContain('MD.commitWrites(WRITES_0)');
    expect(code).not.toContain('MD.markDirty(rowId)');
  });

  it('mixed scope: item-field write + state write → both commits', () => {
    const code = compile(
      `let n = 0;\nlet todos = [{ id: 1, done: false }];\nfunction C() { return <ul>{todos.map((todo) => <li key={todo.id} onClick={() => { todo.done = !todo.done; n++; }}>{n}{todo.done ? 'y' : 'n'}</li>)}</ul>; }`,
    );
    expect(code).toContain('MD.markDirty(rowId)'); // item write stays local
    // n is read by every row (Row[*] readers) → still routes the table
    expect(code).toContain('MD.commitWrites');
  });
});

// ---------------------------------------------------------------------
// 2. compiled output runs
// ---------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  'r11-inline': `let todos = [{ id: 1, done: false }, { id: 2, done: false }];\nexport function C() { return <ul>{todos.map((todo) => <li key={todo.id} onClick={() => { todo.done = !todo.done; }}>{todo.done ? 'y' : 'n'}</li>)}</ul>; }`,
  'r11-comp': `let todos = [{ id: 1, done: false }, { id: 2, done: false }];\nexport function Row(item) { return <li onClick={() => { item.done = !item.done; }}>{item.done ? 'y' : 'n'}</li>; }\nexport function C() { return <ul>{todos.map((todo) => <Row key={todo.id} item={todo} />)}</ul>; }`,
};

describe('R11 — compiled output runs', () => {
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

  it('inline rows: a toggle renders ONLY the clicked row', async () => {
    const { C } = await importCompiled('r11-inline');
    document.body.appendChild(C('App', null));
    expect(document.querySelectorAll('li')).toHaveLength(2);

    const appR = spyRenders('App');
    const row1R = spyRenders('App/todos/Row[1]');
    const row2R = spyRenders('App/todos/Row[2]');

    const first = document.querySelectorAll('li')[0]!;
    first.click();
    expect(first.textContent).toBe('y'); // view synced
    expect(row1R()).toBe(1); // clicked row rendered
    expect(row2R()).toBe(0); // sibling untouched
    expect(appR()).toBe(0); // owner untouched — no reconcile at all
  });

  it('lightweight component rows refresh only the clicked closure', async () => {
    const { C } = await importCompiled('r11-comp');
    document.body.appendChild(C('App', null));
    expect(document.querySelectorAll('li')).toHaveLength(2);

    expect([..._internals().registry.keys()]).toEqual(['App']);

    const second = document.querySelectorAll('li')[1]!;
    second.click();
    expect(second.textContent).toBe('y');
  });
});

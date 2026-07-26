/**
 * M8 / R8 — conditional regions.
 *
 * Codegen: ternary / && / || compile to createCondRegion with branch
 * factories, the region registers as its own entity, and region vars route
 * to '<owner>/when<n>' patterns. Execution: the cond fixture is mounted
 * under happy-dom and driven by clicks — swaps, same-branch updates, and
 * state survival across swaps.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import {
  unregister,
  registeredIds,
  setScheduler,
  resetScheduler,
  _internals,
} from '@memoized-dom/runtime/testing';
import { resetAccessTable, resolveWrites } from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const outDir = join(fixturesDir, 'out');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, `${name}.tsx`), 'utf8');
}

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

// ---------------------------------------------------------------------
// 1. code generation
// ---------------------------------------------------------------------

describe('R8 — code generation', () => {
  it('compiles a ternary to an anchored region with its own entity', () => {
    const code = compile(readFixture('cond'), { runtimePath: '@memoized-dom/runtime' });
    expect(code).toMatchSnapshot();
    expect(code).toMatch(/\.createCondRegion\(_div\d*, _id\d* \+ "\/when0"/);
    // registered as its own entity, render closure over the region variable
    expect(code).toMatch(/render: \(\) => _when\d*\.update\(\)/);
    // region vars route to the region, not the owner
    expect(code).toContain('"App/when0"');
    expect(code).toContain('"App/when0/*"');
    // branch handlers never markDirty(id) — the owner's update doesn't
    // touch the region; commits route through the table
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(2);
    expect(code).toMatch(/_WRITES_\d* = \["\.\/component\.tsx#loggedIn"\]/);
    expect(code).toMatch(/_WRITES_\d* = \["\.\/component\.tsx#count"\]/);
  });

  it('compiles && with an empty else branch', () => {
    const code = compile(
      `let show = false;\nfunction C() { return <div>{show && <b>hi</b>}</div>; }`,
    );
    expect(code).toContain('.createCondRegion(');
    // branches: [thenFactory, null]
    expect(code).toMatch(/createCondRegion\([\s\S]*\[[\s\S]*,\s*null\s*\]\)/);
  });

  it('compiles || with swapped branch indexes', () => {
    const code = compile(
      `let err = false;\nfunction C() { return <div>{err || <b>ok</b>}</div>; }`,
    );
    expect(code).toContain('err ? 1 : 0');
  });

  it('owner-side reads of the same var route to BOTH owner and region', () => {
    const code = compile(
      `let loggedIn = false;\nfunction C() { return <div><span>{loggedIn ? 'bye' : 'hi'}</span>{loggedIn ? <b>a</b> : <i>b</i>}</div>; }`,
    );
    // 'loggedIn' readers: the owner (text ternary) and the region
    expect(code).toMatch(
      /"\.\/component\.tsx#loggedIn": \[[^\]]*"App"[^\]]*"App\/when0"/,
    );
  });

  it('rejects R8 L1 misuses with actionable errors', () => {
    // component inside a branch
    expect(() =>
      compile(
        `let c = false;\nfunction Badge() { return <b />; }\nfunction C() { return <div>{c ? <Badge /> : null}</div>; }`,
      ),
    ).toThrowError(/inside a conditional branch/);

    // list inside a branch
    expect(() =>
      compile(
        `let c = false; let items = [1];\nfunction C() { return <div>{c ? <ul>{items.map(i => <li key={i}>{i}</li>)}</ul> : null}</div>; }`,
      ),
    ).toThrowError(/lists inside conditional branches/);

    // conditional inside a list row
    expect(() =>
      compile(
        `let c = false; let items = [1];\nfunction C() { return <ul>{items.map(i => <li key={i}>{c ? <b>a</b> : null}</li>)}</ul>; }`,
      ),
    ).toThrowError(/conditionals inside list rows/);

    // nested conditional inside a branch
    expect(() =>
      compile(
        `let a = false; let b = false;\nfunction C() { return <div>{a ? <span>{b ? <b>x</b> : null}</span> : null}</div>; }`,
      ),
    ).toThrowError(/nested conditionals/);

    // text branch
    expect(() =>
      compile(
        `let c = false;\nfunction C() { return <div>{c ? 'yes' : <b>no</b>}</div>; }`,
      ),
    ).toThrowError(/branches must be JSX elements/);

    // non-child position
    expect(() =>
      compile(
        `let c = false;\nfunction C() { const x = c ? <b>a</b> : null; return <div>{x}</div>; }`,
      ),
    ).toThrowError(/direct JSX child/);
  });
});

// ---------------------------------------------------------------------
// 2. compiled output runs
// ---------------------------------------------------------------------

describe('R8 — compiled output runs', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'cond.compiled.ts'),
      compile(readFixture('cond'), { runtimePath: '@memoized-dom/runtime' }),
    );
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

  it('swaps branches via the region entity, updates within a branch, keeps state', async () => {
    const { CondApp } = await importCompiled('cond');
    document.body.appendChild(CondApp('App', null));

    // region registered as its own entity; vars route to it (the owner is
    // also matched — handler bodies over-approximate reads, which is safe:
    // the owner's guarded setters no-op and it never calls the region)
    expect(registeredIds()).toEqual(['App', 'App/when0']);
    expect(resolveWrites(['./component.tsx#loggedIn'], registeredIds())).toEqual([
      'App',
      'App/when0',
    ]);
    expect(resolveWrites(['./component.tsx#count'], registeredIds())).toEqual([
      'App',
      'App/when0',
    ]);

    const [toggle] = document.querySelectorAll('button');
    expect(document.querySelector('.out')).not.toBeNull();
    expect(document.querySelector('.in')).toBeNull();

    // swap to the then-branch
    toggle!.click();
    expect(document.querySelector('.out')).toBeNull();
    const inSpan = document.querySelector('.in')!;
    expect(inSpan.textContent).toContain('in 0');

    // same-branch update: 'count' dirties the region only
    const inc = inSpan.querySelector('button')!;
    inc.click();
    expect(document.querySelector('.in')!.textContent).toContain('in 1');
    inc.click();
    expect(document.querySelector('.in')!.textContent).toContain('in 2');

    // swap away and back: DOM is rebuilt, module state survives
    toggle!.click();
    expect(document.querySelector('.out')).not.toBeNull();
    toggle!.click();
    expect(document.querySelector('.in')!.textContent).toContain('in 2');
  });

  it('empty branch renders nothing but the anchor keeps the slot', async () => {
    const src = `let show = false;\nexport function C() { const t = () => { show = !show; }; return <div><button onClick={t}>t</button>{show && <b>hi</b>}</div>; }`;
    writeFileSync(
      join(outDir, 'cond-and.compiled.ts'),
      compile(src, { runtimePath: '@memoized-dom/runtime' }),
    );
    const { C } = await importCompiled('cond-and');
    document.body.appendChild(C('App', null));

    expect(document.querySelector('b')).toBeNull();
    document.querySelector('button')!.click();
    expect(document.querySelector('b')!.textContent).toBe('hi');
    document.querySelector('button')!.click();
    expect(document.querySelector('b')).toBeNull();
    // anchor survives swaps
    expect(document.body.innerHTML).toContain('<!--when:App/when0-->');
  });
});

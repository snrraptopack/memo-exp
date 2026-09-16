/**
 * Reason-gated JSX slots (reactivity precision, slice A).
 *
 *  - a component with two or more exact local sources (instance state, props)
 *    gets dirty-reason ids even without a derivation prelude
 *  - each JSX slot is wrapped in a reason gate naming exactly the sources it
 *    reads (through derivations to their roots); a local write re-evaluates
 *    only the slots that read what was written
 *  - slots that read module state, transparent sources, or unsummarized calls
 *    stay unconditional
 *  - a slot rooted in a module list also opens on the structural-write string
 *    reason, and no gate ever calls `.has` on that string (a structural push
 *    into a reason-gated component used to throw `_reasons.has is not a
 *    function` and was swallowed by event dispatch)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const STRUCTURAL = '\\u0000memo-dom:list-structure:./component.tsx#items';

const SOURCES: Record<string, string> = {
  'slot-gating-app': `
    export let items = [{ id: 1, done: false }];
    export let name = 'x';
    function fmt(n) { return 'n=' + n; }
    function Child({ v, w }) {
      let local = 0;
      return <p class={v > 1 ? 'big' : 'small'} onClick={() => { local++; }}>{v}:{w}:{local}</p>;
    }
    export function App() {
      let a = 0;
      let b = 0;
      const done = items.filter((t) => t.done).length;
      const ab = a + b;
      return (
        <div>
          <span class="done">{done}</span>
          <span class="a">{a}</span>
          <span class="ab">{ab}</span>
          <span class="len">{items.length}</span>
          <span class="name">{name.toUpperCase()}</span>
          <span class="fmt">{fmt(b)}</span>
          <span class="s" title={String(a)}>s</span>
          <Child v={a} w={b} />
          <ul>{items.map((t) => <li key={t.id}>{t.id}</li>)}</ul>
          <button class="inc-a" onClick={() => { a++; }} />
          <button class="inc-b" onClick={() => { b += 2; }} />
          <button class="push" onClick={() => { items.push({ id: items.length + 1, done: true }); }} />
          <button class="rename" onClick={() => { name = 'y'; }} />
        </div>
      );
    }
  `,
  'slot-gating-counted': `
    const evals = globalThis.__slotEvals;
    function probeA(x) { evals.a++; return x; }
    function probeB(x) { evals.b++; return x; }
    export function App() {
      let a = 0;
      let b = 0;
      return (
        <div>
          <span class="a">{probeA(a)}</span>
          <span class="b">{probeB(b)}</span>
          <button class="inc-a" onClick={() => { a++; }} />
          <button class="inc-b" onClick={() => { b++; }} />
        </div>
      );
    }
  `,
};

/** Reason gates in the App update: `[gated slot expression] -> gate text`. */
function gatesOf(code: string, updateVar: string): Map<string, string> {
  const start = code.indexOf(`const ${updateVar} = (`);
  const end = code.indexOf('_MD.register(', start);
  const body = code.slice(start, end);
  const gates = new Map<string, string>();
  for (const match of body.matchAll(
    /if \(((?:_reasons\d*) === null[^\n]*)\) \{\s*if \(_slot\d* !== \(_value\d* = ([^\n]*?)\)\) \{/g,
  )) {
    gates.set(match[2]!, match[1]!);
  }
  return gates;
}

describe('slot reason gating — emission', () => {
  const code = compile(SOURCES['slot-gating-app']!, {
    runtimePath: '@memoized-dom/runtime',
  });

  it('allocates reason ids for a component with several exact sources and no prelude', () => {
    // Child has props v, w and local state: three exact sources, no const
    // derivation — it still receives a reasons parameter and exact marks.
    expect(code).toMatch(/function Child\([\s\S]*?const _update = \(_reasons = null\)/);
    expect(code).toMatch(/local\+\+;\s*_MD\.markDirty\(_id, \d\);/);
  });

  it('gates each slot on exactly the sources it reads', () => {
    const gates = gatesOf(code, '_update2');
    // a=0 b=1 items=2 (sorted source names)
    expect(gates.get('a')).toMatch(/=== 0 \|\| typeof/);
    expect(gates.get('a')).not.toMatch(/=== 1/);
    expect(gates.get('ab')).toMatch(/=== 0 \|\| _reasons2 === 1/);
    expect(gates.get('fmt(b)')).toMatch(/=== 1 \|\| typeof/);
    expect(gates.get('String(a)')).toMatch(/=== 0 \|\| typeof/);
    // derivation rooted in a module list: numeric root + structural string
    expect(gates.get('done')).toContain('=== 2');
    expect(gates.get('done')).toContain(`"${STRUCTURAL}"`);
    expect(gates.get('done')).toContain(`.has("${STRUCTURAL}")`);
  });

  it('leaves module-state slots unconditional', () => {
    const gates = gatesOf(code, '_update2');
    expect(gates.has('items.length')).toBe(false);
    expect(gates.has('name.toUpperCase()')).toBe(false);
    expect(code).toMatch(/\n\s*if \(_slot\d* !== \(_value\d* = items\.length\)\)/);
  });

  it('never dereferences .has on a non-object reason', () => {
    // Every `.has(` must sit behind a `typeof … === "object"` guard.
    for (const match of code.matchAll(/([^\n]*)\.has\(/g)) {
      expect(match[1]).toMatch(/typeof _reasons\d* === "object" &&/);
    }
    expect(code).not.toMatch(/typeof _reasons\d* !== "number"/);
  });

  it('gates the prop-driven class attribute on the prop it reads only', () => {
    const gates = gatesOf(code, '_update');
    // Child sources: local=0 v=1 w=2
    expect(gates.get("_MD.classValue(v > 1 ? 'big' : 'small')")).toMatch(
      /_reasons === null \|\| _reasons === -1 \|\| _reasons === 1 \|\| typeof/,
    );
    expect(gates.get('v + ":" + w + ":" + local')).toMatch(/=== 0 \|\| _reasons === 1 \|\| _reasons === 2/);
  });
});

describe('slot reason gating — compiled runtime behavior', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, source] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(source, { runtimePath: '@memoized-dom/runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    resetScheduler();
  });

  const load = (name: string): Promise<any> =>
    import(/* @vite-ignore */ pathToFileURL(join(outDir, `${name}.compiled.ts`)).href);
  const text = (selector: string): string =>
    document.querySelector(selector)!.textContent!;
  const click = (selector: string): void => {
    (document.querySelector(selector) as HTMLElement).onclick!(new Event('click'));
  };

  it('keeps every slot correct across local, prop, module, and structural writes', async () => {
    const { App } = await load('slot-gating-app');
    document.body.appendChild(App('App', null));
    const snapshot = () => ({
      done: text('.done'),
      a: text('.a'),
      ab: text('.ab'),
      len: text('.len'),
      name: text('.name'),
      fmt: text('.fmt'),
      title: document.querySelector('.s')!.getAttribute('title'),
      child: text('p'),
      childClass: document.querySelector('p')!.getAttribute('class'),
      rows: document.querySelectorAll('li').length,
    });

    expect(snapshot()).toEqual({
      done: '0', a: '0', ab: '0', len: '1', name: 'X', fmt: 'n=0',
      title: '0', child: '0:0:0', childClass: 'small', rows: 1,
    });
    click('.inc-a');
    expect(snapshot()).toMatchObject({ a: '1', ab: '1', title: '1', child: '1:0:0' });
    click('.inc-b');
    expect(snapshot()).toMatchObject({ ab: '3', fmt: 'n=2', child: '1:2:0' });
    // structural push into a reason-gated component: derivation and its
    // slot must both open on the structural string reason
    click('.push');
    expect(snapshot()).toMatchObject({ done: '1', len: '2', rows: 2 });
    click('.rename');
    expect(snapshot()).toMatchObject({ name: 'Y' });
    click('p');
    expect(snapshot()).toMatchObject({ child: '1:2:1' });
    click('.inc-a');
    expect(snapshot()).toMatchObject({
      a: '2', ab: '4', title: '2', child: '2:2:1', childClass: 'big',
    });
  });

  it('a structural push does not throw inside the gated update', async () => {
    const { App } = await load('slot-gating-app');
    document.body.appendChild(App('App', null));
    expect(() => click('.push')).not.toThrow();
    expect(document.querySelectorAll('li')).toHaveLength(2);
  });

  it('re-evaluates only the slots whose source was written', async () => {
    const evals = { a: 0, b: 0 };
    (globalThis as any).__slotEvals = evals;
    const { App } = await load('slot-gating-counted');
    document.body.appendChild(App('App', null));
    expect(evals).toEqual({ a: 1, b: 1 });

    click('.inc-a');
    expect(text('.a')).toBe('1');
    expect(evals).toEqual({ a: 2, b: 1 });
    click('.inc-a');
    expect(text('.a')).toBe('2');
    expect(evals).toEqual({ a: 3, b: 1 });
    click('.inc-b');
    expect(text('.b')).toBe('1');
    expect(evals).toEqual({ a: 3, b: 2 });
  });
});

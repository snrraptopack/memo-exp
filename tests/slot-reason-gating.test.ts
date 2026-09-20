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
 *
 * Reason-carrying prop pushes (slice B):
 *
 *  - a child with reason ids registers a prop-key -> reason map (and a rest
 *    reason for undeclared keys); `setProps` diffs the object envelope per key
 *  - identical primitive props are unchanged: the child is not dirtied at all
 *    when the parent re-rendered for something else
 *  - changed keys dirty the child with exactly their reasons, so the child
 *    skips slots that read other props
 *  - identical objects/functions still count as changed (they may have been
 *    mutated in place), and a key the child has no reason for falls back to a
 *    full update
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
  _propsBox,
  register,
  registerProps,
  resetAccessTable,
  resetScheduler,
  setProps,
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
  'slot-gating-props': `
    export let store = { n: 0 };
    function Child({ v, w, obj }) {
      return <p>{v}:{w}:{obj.n}</p>;
    }
    function Rest({ v, ...others }) {
      return <b>{v}-{others.w}</b>;
    }
    export function App() {
      let a = 0;
      let b = 0;
      let c = 0;
      return (
        <div>
          <span class="c">{c}</span>
          <Child v={a} w={b} obj={store} />
          <Rest v={a} w={b} />
          <button class="inc-a" onClick={() => { a++; }} />
          <button class="inc-b" onClick={() => { b++; }} />
          <button class="inc-c" onClick={() => { c++; }} />
          <button class="mutate" onClick={() => { store.n++; c++; }} />
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
  'slot-gating-member-call': `
    export function App({ reader }) {
      let tick = 0;
      return (
        <div>
          <span class="value">{reader.read()}</span>
          <span class="tick">{tick}</span>
          <button onClick={() => { tick++; }} />
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

  it('keeps an unsummarized member call unconditional', async () => {
    let calls = 0;
    const reader = { read: () => String(++calls) };
    const { App } = await load('slot-gating-member-call');
    document.body.appendChild(App('App', null, [{ reader }]));
    expect(text('.value')).toBe('1');

    click('button');

    expect(text('.tick')).toBe('1');
    expect(text('.value')).toBe('2');
    expect(calls).toBe(2);
  });

  it('pushes props with the reason of the changed key only, and skips unchanged pushes', async () => {
    const { App } = await load('slot-gating-props');
    document.body.appendChild(App('App', null));
    // Child sources sorted: obj=0 v=1 w=2; Rest: others=0 v=1
    const childCalls: unknown[] = [];
    const restCalls: unknown[] = [];
    for (const [id, sink] of [['App/Child', childCalls], ['App/Rest', restCalls]] as const) {
      const e = _internals().registry.get(id)!;
      const orig = e.render;
      e.render = (reasons) => { sink.push(reasons); orig(reasons); };
    }
    expect(text('p')).toBe('0:0:0');
    expect(text('b')).toBe('0-0');

    // parent re-render for an unrelated local: Rest gets identical
    // primitives and is skipped entirely; Child's `obj` is an identical
    // non-primitive — identical objects may have been mutated in place, so
    // it still counts as changed but carries only the obj reason
    click('.inc-c');
    expect(text('.c')).toBe('1');
    expect(restCalls).toHaveLength(0);
    expect(childCalls).toEqual([0]);

    // `a` changes v (reason 1) plus the always-changed obj (reason 0); w's
    // slot is skipped — DOM still shows only v updated
    click('.inc-a');
    expect(text('p')).toBe('1:0:0');
    expect(text('b')).toBe('1-0');
    expect(childCalls[1]).toEqual(new Set([0, 1]));
    expect(restCalls).toEqual([1]);

    // `b` changes w only: Child reasons {0,2}; `w` is undeclared on Rest so
    // it lands on the rest reason
    click('.inc-b');
    expect(text('p')).toBe('1:1:0');
    expect(text('b')).toBe('1-1');
    expect(childCalls[2]).toEqual(new Set([0, 2]));
    expect(restCalls[1]).toBe(0);

    // in-place mutation of the object prop: the parent push carries the
    // same identity, which still counts as changed — the obj slot re-reads
    // it and picks up the mutation
    click('.mutate');
    expect(text('p')).toBe('1:1:1');
    expect(childCalls[3]).toBe(0);
  });
});

describe('reason-carrying prop pushes — emission', () => {
  const code = compile(SOURCES['slot-gating-props']!, {
    runtimePath: '@memoized-dom/runtime',
  });

  it('registers a prop-key -> reason map matching the child reason ids', () => {
    // Child reason ids sort by source name (obj=0 v=1 w=2); keys keep
    // parameter order
    expect(code).toContain('_MD.registerProps(_id, _props, { "v": 1, "w": 2, "obj": 0 })');
  });

  it('registers the rest binding as the reason for undeclared keys', () => {
    // Rest sources sorted: others=0 v=1
    expect(code).toContain('_MD.registerProps(_id2, _props2, { "v": 1 }, 0)');
  });

  it('omits the map when the child has no reason ids', () => {
    const single = compile(
      `function One({ v }) { return <p>{v}</p>; }
       export function App() { let a = 0; return <div><One v={a} /><button onClick={() => { a++; }} /></div>; }`,
      { runtimePath: '@memoized-dom/runtime' },
    );
    expect(single).toMatch(/_MD\.registerProps\(_id, _props\);/);
  });
});

describe('reason-carrying prop pushes — runtime', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((callback) => callback());
  });
  afterEach(() => {
    resetScheduler();
  });

  function child(id: string, keys?: Record<string, number | number[]>, rest?: number) {
    const seen: unknown[] = [];
    register({ id, parent: null, render: (reasons: unknown) => { seen.push(reasons); } });
    const box = [{ v: 1, w: 'a', fn: noop, obj: shared }];
    registerProps(id, box, keys, rest);
    return { seen, box };
  }
  const noop = () => {};
  const shared = { n: 0 };

  it('does not dirty the child when every key is an identical primitive', () => {
    const { seen } = child('P', { v: 0, w: 1 });
    setProps('P', [{ v: 1, w: 'a', fn: noop, obj: shared }]);
    // fn and obj are identical but non-primitive, so this push IS a change
    expect(seen).toHaveLength(1);
    const { seen: primitives } = child('Q', { v: 0, w: 1 });
    _propsBox('Q')![0] = { v: 1, w: 'a' };
    setProps('Q', [{ v: 1, w: 'a' }]);
    expect(primitives).toHaveLength(0);
  });

  it('dirties with exactly the reasons of the changed keys', () => {
    const { seen, box } = child('P', { v: 0, w: 1, fn: 2, obj: 3 });
    setProps('P', [{ v: 2, w: 'a', fn: noop, obj: shared }]);
    // fn/obj always count as changed; v changed; w did not
    expect(seen[0]).toEqual(new Set([0, 2, 3]));
    expect((box[0] as any).v).toBe(2);
    box[0] = { v: 2, w: 'a' };
    setProps('P', [{ v: 2, w: 'b' }]);
    expect(seen[1]).toBe(1);
  });

  it('attributes multi-binding keys, rest keys, and removed keys', () => {
    const { seen, box } = child('P', { v: [0, 4], w: 1 }, 7);
    box[0] = { v: 1, w: 'a' };
    setProps('P', [{ v: 3, w: 'a', extra: true }]);
    expect(seen[0]).toEqual(new Set([0, 4, 7]));
    setProps('P', [{ v: 3, extra: true }]);
    expect(seen[1]).toBe(1);
    box[0] = { v: 3, w: 'a', extra: true };
    setProps('P', [{ v: 3 }]);
    expect(seen[2]).toEqual(new Set([1, 7]));
  });

  it('falls back to a full update for a key without a reason and no rest', () => {
    const { seen, box } = child('P', { v: 0 });
    box[0] = { v: 1 };
    setProps('P', [{ v: 1, unknown: 2 }]);
    expect(seen[0]).toBeNull();
    const { seen: unmapped, box: plain } = child('Q');
    plain[0] = { v: 1 };
    setProps('Q', [{ v: 2 }]);
    expect(unmapped[0]).toBeNull();
  });

  it('keeps positional arrays on the per-index path', () => {
    const seen: unknown[] = [];
    register({ id: 'R', parent: null, render: (reasons: unknown) => { seen.push(reasons); } });
    registerProps('R', [1, 'a'], { v: 0 });
    setProps('R', [1, 'a']);
    expect(seen).toHaveLength(0);
    setProps('R', [2, 'a']);
    expect(seen[0]).toBeNull();
    expect(_propsBox('R')).toEqual([2, 'a']);
  });
});

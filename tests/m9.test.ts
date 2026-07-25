/**
 * R10 — Props flow down through the mutable props box.
 *
 * - state-reading prop on a static child: parent re-pushes via setProps,
 *   child re-renders in the SAME commit (cascading drain), derived prop
 *   expressions update too
 * - shallow-equal re-push is a no-op: the child does NOT re-render
 * - component rows: reconcile re-pushes the row's box (updateProps), so
 *   item-field mutation and item replacement both reach retained rows
 * - unmounted child: setProps is a silent dead letter; the box is dropped
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler/compile';
import {
  register,
  unregister,
  setScheduler,
  resetScheduler,
  _internals,
  type EntityId,
} from '../src/kernel';
import { resetAccessTable } from '../src/access';
import { commitWrites } from '../src/events';
import { registerProps, setProps, _propsBox } from '../src/props';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

const SOURCES: Record<string, string> = {
  // static child with a state-reading prop, incl. a derived expression
  'r10-badge': `let count = 0;\nlet other = 0;\nexport function inc() { count++; }\nexport function bump() { other++; }\nexport function Badge(n) { return <span>{n * 2}</span>; }\nexport function C() { return <div><Badge n={count} /><em>{other}</em></div>; }`,
  // component rows: prop = the item itself (plus a state-reading extra prop)
  'r10-rows': `let items = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];\nlet suffix = '';\nexport function mutateFirst(v) { items[0].label = v; }\nexport function replaceSecond(v) { items = [items[0], { id: 2, label: v }]; }\nexport function setSuffix(v) { suffix = v; }\nexport function Row(item, sfx) { return <li>{item.label}{sfx}</li>; }\nexport function C() { return <ul>{items.map((i) => <Row key={i.id} item={i} sfx={suffix} />)}</ul>; }`,
};

/** Count subsequent renders of one entity by wrapping its registry entry. */
function spyRenders(id: EntityId): () => number {
  const e = _internals().registry.get(id)!;
  let n = 0;
  const orig = e.render;
  e.render = () => {
    n++;
    orig();
  };
  return () => n;
}

describe('R10 — props flow down', () => {
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

  it('parent re-push re-renders the child in the same commit, derived exprs included', async () => {
    const mod = await importCompiled('r10-badge');
    document.body.appendChild(mod.C('App', null));
    expect(document.querySelector('span')!.textContent).toBe('0');

    const appRenders = spyRenders('App');
    const badgeRenders = spyRenders('App/Badge');

    mod.inc();
    commitWrites(['./component.tsx#count']);

    expect(document.querySelector('span')!.textContent).toBe('2'); // n*2 re-synced (count=1)
    expect(appRenders()).toBe(1);
    // same commit, not next frame (may be 2: the 'App/*' covering pattern
    // also hits the child — documented over-approximation, §11.3)
    expect(badgeRenders()).toBeGreaterThanOrEqual(1);
  });

  it('shallow-equal re-push does NOT dirty the child (unit)', () => {
    // pure props.ts semantics: equal values → no mark; changed → mark.
    // (At the compiled level the 'App/*' covering pattern may still render
    // the child on parent writes — over-approximation, safe direction.)
    let renders = 0;
    register({
      id: 'P',
      parent: null,
      render: () => {
        renders++;
      },
    });
    registerProps('P', [1, 'a']);
    setProps('P', [1, 'a']); // identical
    expect(renders).toBe(0);
    setProps('P', [2, 'a']); // one index changed
    expect(renders).toBe(1); // sync scheduler commits immediately
    expect(_propsBox('P')).toEqual([2, 'a']); // box updated in place
  });

  it('component rows: item-field mutation and item replacement both reach retained rows', async () => {
    const mod = await importCompiled('r10-rows');
    document.body.appendChild(mod.C('App', null));
    const lis = () => document.querySelectorAll('li');
    expect(lis()[0]!.textContent).toBe('a');

    // item-field mutation (external, invisible) — reconcile re-pushes the box
    mod.mutateFirst('A');
    commitWrites(['./component.tsx#items']);
    expect(lis()[0]!.textContent).toBe('A');

    // item replacement with the same key — box gets the NEW object
    mod.replaceSecond('B2');
    commitWrites(['./component.tsx#items']);
    expect(lis()[1]!.textContent).toBe('B2');

    // state-reading extra prop flows through updateProps too
    mod.setSuffix('!');
    commitWrites(['./component.tsx#suffix']);
    expect(lis()[0]!.textContent).toBe('A!');
    expect(lis()[1]!.textContent).toBe('B2!');
  });

  it('setProps on an unmounted child is a silent dead letter', async () => {
    const mod = await importCompiled('r10-badge');
    const el = mod.C('App', null);
    document.body.appendChild(el);
    expect(_propsBox('App/Badge')).toBeDefined();

    unregister('App/Badge'); // subtree gone
    expect(_propsBox('App/Badge')).toBeUndefined(); // box dropped via listener
    expect(() => setProps('App/Badge', [1])).not.toThrow();
  });
});

/**
 * R14 and post-R13 correctness hardening:
 * - per-instance derivations recompute in the owner's update prologue
 * - component-local helper callbacks carry their own invalidation
 * - generated child bindings are hygienic
 * - lexical bindings, not identifier spelling, determine module-state reads
 * - identical write sets share one hoisted constant
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '../compiler/compile';
import { resetAccessTable } from '../src/access';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '../src/kernel';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('R14 - code generation', () => {
  it('reuses one hoisted constant for identical write sets', () => {
    const code = compile(`
      let count = 0;
      function A() { return <button onClick={() => count++}>{count}</button>; }
      function B() { return <button onClick={() => count++}>{count}</button>; }
      function App() { return <div><A /><B /></div>; }
    `);
    expect(code.match(/const _WRITES_\d*/g)).toHaveLength(1);
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(2);
  });

  it('uses a hygienic child result binding when component and state names collide', () => {
    const code = compile(`
      let count = 0;
      function Count(value) { return <span>{value}</span>; }
      function App() { return <div><Count value={count} />{count}</div>; }
    `);
    expect(code).toContain('const _count = Count(');
    expect(code).not.toContain('const count = Count(');
  });

  it('tracks module state by binding identity, not a same-named prop', () => {
    const code = compile(`
      let count = 0;
      function Label(count) { return <span>{count}</span>; }
      function App() { return <Label count={count} />; }
    `);
    expect(code).toContain('"./component.tsx#count": ["App", "App/*"]');
    expect(code).not.toContain('"App/Label"');
    expect(() =>
      compile(`
        let count = 0;
        function Label(count) {
          return <button onClick={() => count++}>{count}</button>;
        }
      `),
    ).toThrowError(/cannot update prop 'count'/);
  });

  it('emits local derivations before guarded writes and instruments helper timers', () => {
    const code = compile(`
      function App() {
        let count = 1;
        const doubled = count * 2;
        const label = 'v=' + doubled;
        const later = () => setTimeout(() => count++, 0);
        return <button onClick={() => later()}>{label}</button>;
      }
    `);
    expect(code).toContain('doubled = count * 2');
    expect(code).toContain("label = 'v=' + doubled");
    const timer = code.slice(code.indexOf('setTimeout'), code.indexOf('}, 0)'));
    expect(timer).toMatch(/\.markDirty\(_id\d*\)/);
  });

  it('does not infer local-derivation method semantics from method names', () => {
    const code = compile(`
        function App() {
          let items = [2, 1];
          const sorted = items.sort();
          return <p>{sorted.join(',')}</p>;
        }
      `);
    expect(code).toContain('sorted = items.sort()');
  });
});

const SOURCES: Record<string, string> = {
  'r14-local': `
    export function Counter() {
      let count = 1;
      const doubled = count * 2;
      const label = 'v=' + doubled;
      return <button onClick={() => count++}>{label}</button>;
    }
    export function App() { return <div><Counter /><Counter /></div>; }
  `,
  'r14-prop': `
    function Label(value) {
      const doubled = value * 2;
      return <strong>{doubled}</strong>;
    }
    export function App() {
      let count = 1;
      return <div><button onClick={() => count++}>inc</button><Label value={count} /></div>;
    }
  `,
  'r14-timer': `
    export function App() {
      let count = 0;
      const later = () => setTimeout(() => count++, 0);
      return <button onClick={() => later()}>{count}</button>;
    }
  `,
  'r14-hygiene': `
    let count = 0;
    function Count(value) { return <span>{value}</span>; }
    export function App() {
      return <div><Count value={count} /><button onClick={() => count++}>inc</button></div>;
    }
  `,
  'r14-const-collection': `
    export function App() {
      const items = [1];
      return <button onClick={() => items.push(items.length + 1)}>{items.length}</button>;
    }
  `,
};

describe('R14 - compiled execution', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, source] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(source, { runtimePath: '../out-runtime' }),
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

  it('keeps local derivations isolated per instance', async () => {
    const { App } = await importCompiled('r14-local');
    document.body.appendChild(App('App', null));
    const [first, second] = document.querySelectorAll('button');
    expect(first!.textContent).toBe('v=2');
    first!.click();
    expect(first!.textContent).toBe('v=4');
    expect(second!.textContent).toBe('v=2');
  });

  it('recomputes prop-derived values after props resync', async () => {
    const { App } = await importCompiled('r14-prop');
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    const label = document.querySelector('strong')!;
    expect(label.textContent).toBe('2');
    button.click();
    expect(label.textContent).toBe('4');
  });

  it('commits a timer callback reached through a component-local helper', async () => {
    const { App } = await importCompiled('r14-timer');
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    button.click();
    expect(button.textContent).toBe('0');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(button.textContent).toBe('1');
  });

  it('mounts and updates through a child/state naming collision', async () => {
    const { App } = await importCompiled('r14-hygiene');
    document.body.appendChild(App('App', null));
    const span = document.querySelector('span')!;
    document.querySelector('button')!.click();
    expect(span.textContent).toBe('1');
  });

  it('treats a component-local const collection as instance state', async () => {
    const { App } = await importCompiled('r14-const-collection');
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    button.click();
    expect(button.textContent).toBe('2');
  });
});

/**
 * R20 verifies explicit component-owned cleanup and factory callback commits.
 *
 * Coverage includes direct timers, subscriptions, DOM listeners, keyed-row
 * removal, cleanup ordering/failures, and invalid ownership syntax.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import { cleanup } from '@memoized-dom/runtime/testing';
import {
  _internals,
  has,
  register,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCES: Record<string, string> = {
  'r20-timer': `
    export let disposed = 0;
    export function App() {
      let count = 0;
      const start = () => setInterval(() => count++, 2);
      const timer = start();
      cleanup(() => {
        disposed++;
        clearInterval(timer);
      });
      return <output id="timer">{count}</output>;
    }
  `,
  'r20-subscription': `
    const listeners = [];
    function subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }
    export function emit() {
      for (const listener of listeners.slice()) listener();
    }
    export function App() {
      let count = 0;
      cleanup(subscribe(() => count++));
      return <output id="subscription">{count}</output>;
    }
  `,
  'r20-listener': `
    export function App() {
      let count = 0;
      const receive = () => count++;
      window.addEventListener('memo-ping', receive);
      cleanup(() => window.removeEventListener('memo-ping', receive));
      return <output id="listener">{count}</output>;
    }
  `,
  'r20-rows': `
    const rows = [{ id: 1 }, { id: 2 }];
    export let disposed = 0;
    function Row(item) {
      cleanup(() => disposed++);
      return <li>{item.id}</li>;
    }
    export function App() {
      return <main>
        <button onClick={() => rows.pop()}>remove</button>
        <ul>{rows.map(item => <Row key={item.id} item={item} />)}</ul>
      </main>;
    }
  `,
};

const IMPORTS: Record<string, () => Promise<any>> = {
  'r20-timer': () => import('./fixtures/out/r20-timer.compiled.ts'),
  'r20-subscription': () =>
    import('./fixtures/out/r20-subscription.compiled.ts'),
  'r20-listener': () => import('./fixtures/out/r20-listener.compiled.ts'),
  'r20-rows': () => import('./fixtures/out/r20-rows.compiled.ts'),
};

function importCompiled(name: string): Promise<any> {
  return IMPORTS[name]!();
}

describe('R20 - cleanup runtime ownership', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('runs descendants before owners and each owner in LIFO order', () => {
    const order: string[] = [];
    cleanup('Root', () => order.push('root-first'));
    cleanup('Root', () => order.push('root-second'));
    cleanup('Root/Child', () => order.push('child'));
    register({ id: 'Root', parent: null, render() {} });
    register({ id: 'Root/Child', parent: 'Root', render() {} });

    unregister('Root');

    expect(order).toEqual(['child', 'root-second', 'root-first']);
  });

  it('finishes subtree teardown when a disposer throws', () => {
    const expected = new Error('cleanup failed');
    let laterRan = false;
    cleanup('Root/Child', () => {
      laterRan = true;
    });
    cleanup('Root/Child', () => {
      throw expected;
    });
    register({ id: 'Root', parent: null, render() {} });
    register({ id: 'Root/Child', parent: 'Root', render() {} });

    expect(() => unregister('Root')).toThrow(expected);
    expect(laterRan).toBe(true);
    expect(has('Root')).toBe(false);
    expect(has('Root/Child')).toBe(false);
  });
});

describe('R20 - cleanup compiler contract', () => {
  it('lowers explicit ownership and instruments direct factory timers', () => {
    const code = compile(SOURCES['r20-timer']!);
    expect(code).toMatch(/\.cleanup\(_id\d*, \(\) =>/);
    expect(code).toMatch(/setInterval\(\(\) => \{[\s\S]*\.markDirty\(_id\d*\)/);
    expect(code).not.toContain('try {');
    expect(code).not.toContain('finally');
  });

  it('commits an inline interval without an event-handler wrapper', () => {
    const code = compile(`
      function App() {
        let timer = 0;
        const interval = setInterval(() => {
          timer++;
        }, 1000);
        cleanup(() => clearInterval(interval));
        return <p>{timer}</p>;
      }
    `);
    const interval = code.slice(
      code.indexOf('setInterval'),
      code.indexOf('}, 1000)'),
    );
    expect(interval).toMatch(/timer\+\+[\s\S]*\.markDirty\(_id\d*\)/);
  });

  it('table-routes writes from a module-level interval callback', () => {
    const code = compile(`
      let timer = 0;
      setInterval(() => timer++, 1000);
      function App() { return <p>{timer}</p>; }
    `);
    const interval = code.slice(
      code.indexOf('setInterval'),
      code.indexOf(', 1000)'),
    );
    expect(interval).toMatch(/timer\+\+[\s\S]*\.commitWrites\(_WRITES_\d*\)/);
    expect(interval).not.toMatch(/\.markDirty\(_id\d*\)/);
  });

  it('leaves JSX-producing list callbacks to row/event emission', () => {
    const code = compile(`
      const rows = [{ id: 1 }];
      let selected = null;
      function App() {
        return <ul>{rows.map(item =>
          <li onClick={() => selected = item.id}>{item.id}</li>
        )}</ul>;
      }
    `);
    expect(code.match(/\.commitWrites\(_WRITES_\d*\)/g)).toHaveLength(1);
  });

  it('does not hijack a lexically bound cleanup function', () => {
    const code = compile(`
      function cleanup(disposer) { disposer(); }
      function App() {
        cleanup(() => {});
        return <p>ok</p>;
      }
    `);
    expect(code).toContain('cleanup(() => {})');
    expect(code).not.toMatch(/\.cleanup\(_id\d*/);
  });

  it('rejects cleanup without direct component ownership', () => {
    expect(() =>
      compile(`
        function App() {
          const later = () => cleanup(() => {});
          return <button onClick={later}>later</button>;
        }
      `),
    ).toThrowError(/must run directly during component factory initialization/);
    expect(() =>
      compile(`
        function helper() { cleanup(() => {}); }
        function App() { return <p>ok</p>; }
      `),
    ).toThrowError(/only valid directly inside a component factory/);
  });

  it('keeps listed components with cleanup as lifecycle entities', () => {
    const code = compile(SOURCES['r20-rows']!);
    expect(code).toMatch(
      /function Row\(_id\d*, _parent\d*, _props\d*\)[\s\S]*?\.register\(/,
    );
  });
});

describe('R20 - compiled lifecycle execution', () => {
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
    setScheduler((fn) => fn());
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('updates from a factory-started timer and stops it on unmount', async () => {
    const mod = await importCompiled('r20-timer');
    document.body.appendChild(mod.App('App', null));
    const output = document.querySelector('#timer')!;

    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(Number(output.textContent)).toBeGreaterThan(0);

    unregister('App');
    const stoppedAt = output.textContent;
    await new Promise((resolve) => setTimeout(resolve, 8));
    expect(output.textContent).toBe(stoppedAt);
    expect(mod.disposed).toBe(1);
  });

  it('updates and unsubscribes an arbitrary callback API', async () => {
    const mod = await importCompiled('r20-subscription');
    document.body.appendChild(mod.App('App', null));
    const output = document.querySelector('#subscription')!;

    mod.emit();
    expect(output.textContent).toBe('1');
    unregister('App');
    mod.emit();
    expect(output.textContent).toBe('1');
  });

  it('updates and removes a factory-owned DOM listener', async () => {
    const mod = await importCompiled('r20-listener');
    document.body.appendChild(mod.App('App', null));
    const output = document.querySelector('#listener')!;

    window.dispatchEvent(new Event('memo-ping'));
    expect(output.textContent).toBe('1');
    unregister('App');
    window.dispatchEvent(new Event('memo-ping'));
    expect(output.textContent).toBe('1');
  });

  it('runs row cleanup when list reconciliation removes an entity', async () => {
    const mod = await importCompiled('r20-rows');
    document.body.appendChild(mod.App('App', null));
    expect(has('App/rows/Row[2]')).toBe(true);

    document.querySelector('button')!.click();

    expect(has('App/rows/Row[2]')).toBe(false);
    expect(mod.disposed).toBe(1);
  });
});

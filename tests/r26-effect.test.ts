/**
 * R26 — compiler-owned reactive side effects.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  commit,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('R26 — effect code generation and validation', () => {
  it('registers an effect and routes module reads directly to it', () => {
    const code = compile(`
      let count = 0;
      export function App() {
        effect(() => console.log(count));
        return <main>ready</main>;
      }
    `);

    expect(code).toContain('.registerEffect(');
    expect(code).toContain('"/$effects/0"');
    expect(code).toContain(
      '"./component.tsx#count": ["App/$effects/0"]',
    );
    expect(code).not.toContain(
      '"./component.tsx#count": ["App",',
    );
    expect(
      code.slice(code.indexOf('.registerEffect(')),
    ).not.toContain('.commitWrites(');
  });

  it('emits a post-render invalidation for local dependencies', () => {
    const code = compile(`
      export function App() {
        let count = 0;
        effect(() => console.log(count));
        return <button onClick={() => count++}>{count}</button>;
      }
    `);

    const update = code.slice(
      code.indexOf('const _update'),
      code.indexOf('.register({'),
    );
    expect(update).toContain('.data =');
    expect(update).toContain('.markDirty(');
    expect(update.indexOf('.markDirty(')).toBeGreaterThan(
      update.indexOf('.data ='),
    );
  });

  it('instruments effect writes with the ordinary commit pipeline', () => {
    const code = compile(`
      let source = 1;
      let sink = 0;

      export function App() {
        effect(() => {
          sink = source * 2;
        });
        return <output>{sink}</output>;
      }
    `);

    const registration = code.slice(code.indexOf('.registerEffect('));
    expect(registration).toContain('sink = source * 2');
    expect(registration).toContain('.commitWrites(');
    expect(code).toContain(
      '"./component.tsx#source": ["App/$effects/0"]',
    );
  });

  it('guards each effect write site by whether it executed', () => {
    const code = compile(`
      let count = 0;

      export function App() {
        effect(() => {
          if (count < 2) count++;
        });
        return <output>{count}</output>;
      }
    `);

    const registration = code.slice(code.indexOf('.registerEffect('));
    expect(registration).toMatch(/let _didWrite\w* = false/);
    expect(registration).toMatch(
      /if \(count < 2\) _didWrite\w* = true, count\+\+/,
    );
    expect(registration).toMatch(
      /if \(_didWrite\w*\) _MD\.commitWrites\(/,
    );
  });

  it('does not hijack a lexically bound effect function', () => {
    const code = compile(`
      export function App() {
        function effect(callback) { callback(); }
        effect(() => console.log("ordinary"));
        return <main>ready</main>;
      }
    `);

    expect(code).toContain('effect(() => console.log("ordinary"))');
    expect(code).not.toContain('.registerEffect(');
  });

  it('rejects unsupported effect locations and callback forms', () => {
    expect(() =>
      compile(`
        export function App() {
          const start = () => effect(() => console.log("nested"));
          return <button onClick={start}>start</button>;
        }
      `),
    ).toThrowError(/direct top-level statement/);

    expect(() =>
      compile(`
        export function App() {
          effect(async () => console.log("async"));
          return <main>ready</main>;
        }
      `),
    ).toThrowError(/must be synchronous/);

    expect(() =>
      compile(`
        effect(() => console.log("module"));
        export function App() { return <main>ready</main>; }
      `),
    ).toThrowError(/only valid .* component body/);
  });
});

const SOURCES: Record<string, string> = {
  'r26-local': `
    export function App() {
      let count = 0;
      let unrelated = 0;

      effect(() => {
        const value = count;
        const text = document.querySelector("#count")?.textContent ?? "missing";
        console.log("run:" + value + ":dom:" + text);
        return () => console.log("cleanup:" + value);
      });

      return <main>
        <button id="increment" onClick={() => count++}>increment</button>
        <button id="unrelated" onClick={() => unrelated++}>unrelated</button>
        <output id="count">{count}</output>
        <output id="other">{unrelated}</output>
      </main>;
    }
  `,
  'r26-module': `
    let items = [1];
    let unrelated = 0;
    const totalCount = items.length;

    export function App() {
      effect(() => {
        console.log("total:" + totalCount);
      });

      return <main>
        <button id="add" onClick={() => items.push(items.length + 1)}>add</button>
        <button id="module-unrelated" onClick={() => unrelated++}>other</button>
        <output>{unrelated}</output>
      </main>;
    }
  `,
  'r26-cascade': `
    function Child(value) {
      return <output id="child-value">{value}</output>;
    }

    export function App() {
      let count = 0;

      effect(() => {
        const child = document.querySelector("#child-value")?.textContent ?? "missing";
        console.log("count:" + count + ":child:" + child);
      });

      return <main>
        <button id="cascade" onClick={() => count++}>increment</button>
        <Child value={count} />
      </main>;
    }
  `,
  'r26-write': `
    let source = 1;
    let sink = 0;

    export function App() {
      effect(() => {
        sink = source * 2;
      });

      return <main>
        <button id="write-source" onClick={() => source++}>increment</button>
        <output id="write-source-value">{source}</output>
        <output id="write-sink-value">{sink}</output>
      </main>;
    }
  `,
  'r26-stabilize': `
    let count = 0;

    export function App() {
      effect(() => {
        if (count < 2) count++;
      });

      return <output id="stabilized-count">{count}</output>;
    }
  `,
  'r26-cycle': `
    let count = 0;

    export function App() {
      effect(() => {
        count++;
      });

      return <output>{count}</output>;
    }
  `,
  'r26-consume': `
    let count = 0;

    export function App() {
      effect(() => {
        console.log(count);
      });

      return <main>
        <button id="consume-increment" onClick={() => count++}>increment</button>
        <output id="consumed-count">{count}</output>
      </main>;
    }
  `,
};

describe('R26 — compiled effect execution', () => {
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetScheduler();
    vi.restoreAllMocks();
  });

  it('runs initially, sees updated DOM on rerun, and ignores exact unrelated local writes', async () => {
    const { App } = await importCompiled('r26-local');
    document.body.appendChild(App('App', null));

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenLastCalledWith('run:0:dom:missing');

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#count')!.textContent).toBe('1');
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['run:0:dom:missing'],
      ['cleanup:0'],
      ['run:1:dom:1'],
    ]);

    document.querySelector<HTMLButtonElement>('#unrelated')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      'run:0:dom:missing',
      'cleanup:0',
      'run:1:dom:1',
    ].map((value) => [value]));
  });

  it('runs the latest teardown when the owner unmounts', async () => {
    const { App } = await importCompiled('r26-local');
    document.body.appendChild(App('App', null));
    document.querySelector<HTMLButtonElement>('#increment')!.click();

    unregister('App');
    expect(console.log).toHaveBeenLastCalledWith('cleanup:1');
  });

  it('waits for changed computeds and ignores unrelated module updates', async () => {
    const { App } = await importCompiled('r26-module');
    document.body.appendChild(App('App', null));
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['total:1'],
    ]);

    document.querySelector<HTMLButtonElement>('#module-unrelated')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['total:1'],
    ]);

    document.querySelector<HTMLButtonElement>('#add')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['total:1'],
      ['total:2'],
    ]);
  });

  it('deduplicates multiple local writes into one effect execution per commit', async () => {
    const queue: Array<() => void> = [];
    setScheduler((fn) => queue.push(fn));

    const { App } = await importCompiled('r26-local');
    document.body.appendChild(App('App', null));
    expect(queue).toHaveLength(1);
    queue.shift()!();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['run:0:dom:0'],
    ]);

    const increment =
      document.querySelector<HTMLButtonElement>('#increment')!;
    increment.click();
    increment.click();
    expect(queue).toHaveLength(1);
    queue.shift()!();

    expect(document.querySelector('#count')!.textContent).toBe('2');
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['run:0:dom:0'],
      ['cleanup:0'],
      ['run:2:dom:2'],
    ]);
    expect(queue).toHaveLength(0);

    // No pending work was hidden by the manual scheduler.
    commit();
  });

  it('runs after prop cascades have updated descendant DOM', async () => {
    const { App } = await importCompiled('r26-cascade');
    document.body.appendChild(App('App', null));
    expect(console.log).toHaveBeenLastCalledWith(
      'count:0:child:missing',
    );

    document.querySelector<HTMLButtonElement>('#cascade')!.click();
    expect(document.querySelector('#child-value')!.textContent).toBe('1');
    expect(console.log).toHaveBeenLastCalledWith('count:1:child:1');
  });

  it('propagates non-cyclic writes made by an effect', async () => {
    const { App } = await importCompiled('r26-write');
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#write-source-value')!.textContent).toBe('1');
    expect(document.querySelector('#write-sink-value')!.textContent).toBe('2');

    document.querySelector<HTMLButtonElement>('#write-source')!.click();
    expect(document.querySelector('#write-source-value')!.textContent).toBe('2');
    expect(document.querySelector('#write-sink-value')!.textContent).toBe('4');
  });

  it('lets a conditional self-write stabilize when its branch stops executing', async () => {
    const { App } = await importCompiled('r26-stabilize');
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#stabilized-count')!.textContent).toBe('2');
  });

  it('retains the cascade guard for a genuine effect cycle', async () => {
    const { App } = await importCompiled('r26-cycle');

    expect(() => App('App', null)).toThrowError(
      /commit cascade exceeded 100 passes/,
    );
  });

  it('treats reactive arguments passed to unknown effect APIs as read-only consumption', async () => {
    const { App } = await importCompiled('r26-consume');
    document.body.appendChild(App('App', null));

    expect(vi.mocked(console.log).mock.calls).toEqual([[0]]);

    document.querySelector<HTMLButtonElement>('#consume-increment')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([[0], [1]]);
  });
});

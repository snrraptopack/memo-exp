/**
 * Regressions for fix.md findings:
 * 1. `return null/false/undefined` empty branches in component return plans.
 * 2. Local const derivations before the terminal return in list callbacks.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
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

describe('fix.md - empty return branches', () => {
  const SOURCES: Record<string, string> = {
    'fix-null-tail-chain': `
      let phase = 0;
      function Controls() {
        return <nav>
          <button id="to-zero" onClick={() => phase = 0}>zero</button>
          <button id="to-one" onClick={() => phase = 1}>one</button>
          <button id="to-two" onClick={() => phase = 2}>two</button>
        </nav>;
      }
      function View() {
        if (phase === 0) return null;
        if (phase === 1) {
          return <p id="one">one</p>;
        }
        return <main id="two">two</main>;
      }
      export function App() {
        return <section><Controls /><View /></section>;
      }
    `,
    'fix-null-terminal-ifelse': `
      let visible = true;
      function Controls() {
        return <nav>
          <button id="show" onClick={() => visible = true}>show</button>
          <button id="hide" onClick={() => visible = false}>hide</button>
        </nav>;
      }
      function View() {
        if (visible) {
          return <p id="visible">visible</p>;
        } else {
          return null;
        }
      }
      export function App() {
        return <section><Controls /><View /></section>;
      }
    `,
    'fix-null-switch-case': `
      let mode = 'empty';
      function Controls() {
        return <nav>
          <button id="mode-empty" onClick={() => mode = 'empty'}>empty</button>
          <button id="mode-text" onClick={() => mode = 'text'}>text</button>
          <button id="mode-other" onClick={() => mode = 'other'}>other</button>
        </nav>;
      }
      function View() {
        switch (mode) {
          case 'empty':
            return null;
          case 'text':
            return <p id="text">text</p>;
          default:
            return <article id="other">other</article>;
        }
      }
      export function App() {
        return <section><Controls /><View /></section>;
      }
    `,
    'fix-false-and-undefined': `
      let kind = 0;
      function Controls() {
        return <nav>
          <button id="kind-0" onClick={() => kind = 0}>zero</button>
          <button id="kind-1" onClick={() => kind = 1}>one</button>
          <button id="kind-2" onClick={() => kind = 2}>two</button>
        </nav>;
      }
      function View() {
        if (kind === 1) return false;
        if (kind === 2) return undefined;
        return <p id="fallback">fallback</p>;
      }
      export function App() {
        return <section><Controls /><View /></section>;
      }
    `,
  };

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
    resetScheduler();
  });

  it('lowers a leading `return null` into one stable switching region', async () => {
    const { App } = await importCompiled('fix-null-tail-chain');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#one')).toBeNull();

    document.querySelector<HTMLButtonElement>('#to-one')!.click();
    expect(document.querySelector('#one')?.textContent).toBe('one');

    document.querySelector<HTMLButtonElement>('#to-zero')!.click();
    expect(document.querySelector('#one')).toBeNull();

    document.querySelector<HTMLButtonElement>('#to-two')!.click();
    expect(document.querySelector('#two')?.textContent).toBe('two');
  });

  it('renders an empty terminal else arm', async () => {
    const { App } = await importCompiled('fix-null-terminal-ifelse');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#visible')?.textContent).toBe('visible');

    document.querySelector<HTMLButtonElement>('#hide')!.click();
    expect(document.querySelector('#visible')).toBeNull();

    document.querySelector<HTMLButtonElement>('#show')!.click();
    expect(document.querySelector('#visible')?.textContent).toBe('visible');
  });

  it('renders an empty switch case as one branch of the region', async () => {
    const { App } = await importCompiled('fix-null-switch-case');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#text')).toBeNull();

    document.querySelector<HTMLButtonElement>('#mode-text')!.click();
    expect(document.querySelector('#text')?.textContent).toBe('text');

    document.querySelector<HTMLButtonElement>('#mode-other')!.click();
    expect(document.querySelector('#other')?.textContent).toBe('other');

    document.querySelector<HTMLButtonElement>('#mode-empty')!.click();
    expect(document.querySelector('#other')).toBeNull();
  });

  it('accepts false and undefined as empty branch values', async () => {
    const { App } = await importCompiled('fix-false-and-undefined');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#fallback')?.textContent).toBe('fallback');

    document.querySelector<HTMLButtonElement>('#kind-1')!.click();
    expect(document.querySelector('#fallback')).toBeNull();

    document.querySelector<HTMLButtonElement>('#kind-2')!.click();
    expect(document.querySelector('#fallback')).toBeNull();

    document.querySelector<HTMLButtonElement>('#kind-0')!.click();
    expect(document.querySelector('#fallback')?.textContent).toBe('fallback');
  });
});

describe('fix.md - list callback local derivations', () => {
  const SOURCES: Record<string, string> = {
    'fix-row-derived': `
      let items = [{ id: 1, done: false }, { id: 2, done: true }];
      export function App() {
        return <ul>
          {items.map((item) => {
            const label = item.done ? 'done' : 'open';
            return (
              <li key={item.id} class={label} onClick={() => { item.done = !item.done; }}>
                {item.id}:{label}
              </li>
            );
          })}
        </ul>;
      }
    `,
    'fix-row-derived-chain': `
      let rows = [{ id: 3, score: 4 }];
      export function App() {
        return <div>
          {rows.map((row) => {
            const doubled = row.score * 2;
            const label = 'score:' + doubled;
            return <span key={row.id}>{label}</span>;
          })}
        </div>;
      }
    `,
  };

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
    resetScheduler();
  });

  it('compiles derived labels inside keyed rows and stays fresh on updates', async () => {
    const { App } = await importCompiled('fix-row-derived');
    document.body.appendChild(App('App', null));
    const rows = () => [...document.querySelectorAll('li')];
    expect(rows().map((row) => [row.className, row.textContent])).toEqual([
      ['open', '1:open'],
      ['done', '2:done'],
    ]);

    rows()[0]!.click();
    expect(rows().map((row) => [row.className, row.textContent])).toEqual([
      ['done', '1:done'],
      ['done', '2:done'],
    ]);

    rows()[1]!.click();
    expect(rows().map((row) => [row.className, row.textContent])).toEqual([
      ['done', '1:done'],
      ['open', '2:open'],
    ]);
  });

  it('substitutes chained derivations in source order', async () => {
    const { App } = await importCompiled('fix-row-derived-chain');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('span')?.textContent).toBe('score:8');
  });

  it('rejects non-const statements before the row return', () => {
    expect(() =>
      compile(`
        let items = [{ id: 1 }];
        export function App() {
          return <ul>
            {items.map((item) => {
              item.done = !item.done;
              return <li key={item.id}>{item.id}</li>;
            })}
          </ul>;
        }
      `),
    ).toThrowError(/single-name const declarations/);
  });

  it('rejects impure derivation initializers', () => {
    expect(() =>
      compile(`
        let items = [{ id: 1 }];
        export function App() {
          return <ul>
            {items.map((item) => {
              const next = item.id++;
              return <li key={item.id}>{next}</li>;
            })}
          </ul>;
        }
      `),
    ).toThrowError(/pure const expressions/);
  });

  it('rejects derivations shadowed inside the row JSX', () => {
    expect(() =>
      compile(`
        let items = [{ id: 1 }];
        export function App() {
          return <ul>
            {items.map((item) => {
              const label = item.done ? 'y' : 'n';
              return <li key={item.id} onClick={(label) => {}}>{label}</li>;
            })}
          </ul>;
        }
      `),
    ).toThrowError(/is shadowed inside the row JSX/);
  });
});

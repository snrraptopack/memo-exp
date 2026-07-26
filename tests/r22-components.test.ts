/**
 * R22 verifies graph-linked component factories across compiled modules.
 *
 * Coverage focuses on caller-derived alias ids, defining-module state reads,
 * lazy caller-owned children, cleanup ownership, and imported keyed rows.
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
  vi,
} from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { resetAccessTable, resolveWrites } from '@memoized-dom/runtime/testing';
import {
  _internals,
  has,
  registeredIds,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

function writeCompiled(
  prefix: string,
  modules: Record<string, string>,
): void {
  const output = compileModules(modules, {
    aliases: { '@': `./${prefix}` },
    runtimePath: '@memoized-dom/runtime',
  });
  for (const [id, code] of Object.entries(output)) {
    const target = join(outDir, id.slice(2).replace(/\.tsx?$/, '.ts'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, code);
  }
}

describe('R22 - cross-file component composition', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeCompiled('r22-static', {
      './r22-static/state.ts': `
        export const store = { count: 0 };
        export function bump() { store.count++; }
        export function reset() { store.count = 0; }
      `,
      './r22-static/panel.tsx': `
        import { store, bump } from './state';
        export let disposed = 0;
        export function resetDisposed() { disposed = 0; }
        function Badge() {
          return <output id="badge">{store.count}</output>;
        }
        export default function Panel(props) {
          let local = 0;
          cleanup(() => disposed++);
          return <section>
            <button id="panel" onClick={() => {
              local++;
              bump();
            }}>{props.label}:{local}:{store.count}</button>
            <Badge />
            <div>{props.children}</div>
          </section>;
        }
      `,
      './r22-static/app.tsx': `
        import { store } from './state';
        import Shell from './panel';
        export function App() {
          let child = 0;
          return <main>
            <Shell label={store.count}>
              <button id="child" onClick={() => child++}>{child}</button>
            </Shell>
          </main>;
        }
      `,
    });

    writeCompiled('r22-rows', {
      './r22-rows/row.tsx': `
        export function Row(item) {
          return <button class="row" onClick={() => item.title += "!"}>
            {item.title}
          </button>;
        }
      `,
      './r22-rows/app.tsx': `
        import { Row as TodoRow } from './row';
        export function App() {
          const todos = [
            { id: 1, title: "a" },
            { id: 2, title: "b" },
          ];
          return <main>
            <button id="remove" onClick={() => todos.pop()}>remove</button>
            <div>{todos.map(todo =>
              <TodoRow key={todo.id} item={todo} />
            )}</div>
          </main>;
        }
      `,
    });

    writeCompiled('r22-prop-list', {
      './r22-prop-list/row.tsx': `
        export function Row(item) {
          return <li class="prop-row">{item.label}</li>;
        }
      `,
      './r22-prop-list/list.tsx': `
        import { Row } from './row';
        export function List({ items }) {
          return <ul>{items.map(item =>
            <Row key={item.id} item={item} />
          )}</ul>;
        }
      `,
      './r22-prop-list/app.tsx': `
        import { List } from './list';
        export function App() {
          let items = [
            { id: 1, label: "a" },
            { id: 2, label: "b" },
          ];
          return <main>
            <button id="remove-prop-row" onClick={() => {
              items = items.slice(0, -1);
            }}>remove</button>
            <List items={items} />
          </main>;
        }
      `,
    });

    writeCompiled('r22-timer', {
      './r22-timer/clock.tsx': `
        export let ticks = 0;
        export function reset() { ticks = 0; }
        export function Clock() {
          let shown = 0;
          const interval = setInterval(() => {
            shown++;
            ticks++;
          }, 100);
          cleanup(() => clearInterval(interval));
          return <output id="clock">{shown}</output>;
        }
      `,
      './r22-timer/app.tsx': `
        import { Clock as Timer } from './clock';
        export function App() {
          return <main><Timer /></main>;
        }
      `,
    });
  });

  beforeEach(async () => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
    const state = await importFixture('./fixtures/out/r22-static/state.ts');
    const panel = await importFixture('./fixtures/out/r22-static/panel.ts');
    state.reset();
    panel.resetDisposed();
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('routes defining-file reads to an aliased caller id', async () => {
    const { App } = await importFixture('./fixtures/out/r22-static/app.ts');
    const panel = await importFixture('./fixtures/out/r22-static/panel.ts');
    document.body.appendChild(App('App', null));

    expect(has('App/Shell')).toBe(true);
    expect(has('App/Shell/Badge')).toBe(true);
    expect(
      resolveWrites(
        ['./r22-static/state.ts#store.count'],
        registeredIds(),
      ).sort(),
    ).toEqual(['App', 'App/Shell', 'App/Shell/Badge'].sort());

    document.querySelector<HTMLButtonElement>('#panel')!.click();
    expect(document.querySelector('#panel')!.textContent).toBe('1:1:1');
    expect(document.querySelector('#badge')!.textContent).toBe('1');
    document.querySelector<HTMLButtonElement>('#child')!.click();
    expect(document.querySelector('#child')!.textContent).toBe('1');

    unregister('App');
    expect(panel.disposed).toBe(1);
  });

  it('uses the defining factory ABI for imported keyed rows', async () => {
    const { App } = await importFixture('./fixtures/out/r22-rows/app.ts');
    document.body.appendChild(App('App', null));
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.row')];

    expect(rows().map((row) => row.textContent)).toEqual(['a', 'b']);
    rows()[0]!.click();
    expect(rows().map((row) => row.textContent)).toEqual(['a!', 'b']);
    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect(rows().map((row) => row.textContent)).toEqual(['a!']);
  });

  it('reconciles an imported keyed list from a refreshed destructured prop', async () => {
    const { App } = await importFixture(
      './fixtures/out/r22-prop-list/app.ts',
    );
    document.body.appendChild(App('App', null));
    const labels = () =>
      [...document.querySelectorAll('.prop-row')].map(
        (row) => row.textContent,
      );

    expect(labels()).toEqual(['a', 'b']);
    document.querySelector<HTMLButtonElement>('#remove-prop-row')!.click();
    expect(labels()).toEqual(['a']);
  });

  it('keeps direct factory timers owned by the imported entity', async () => {
    vi.useFakeTimers();
    try {
      const { App } = await importFixture('./fixtures/out/r22-timer/app.ts');
      const clock = await importFixture('./fixtures/out/r22-timer/clock.ts');
      clock.reset();
      document.body.appendChild(App('App', null));

      vi.advanceTimersByTime(200);
      expect(document.querySelector('#clock')!.textContent).toBe('2');
      expect(clock.ticks).toBe(2);

      unregister('App');
      vi.advanceTimersByTime(200);
      expect(clock.ticks).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('R22 - graph validation', () => {
  it('resolves configured aliases for imported component factories', () => {
    const output = compileModules(
      {
        './src/frame.tsx': `
          export function Frame(value) { return <p>{value}</p>; }
        `,
        './src/app.tsx': `
          import { Frame as Shell } from '@/frame';
          export function App() { return <Shell value={"ok"} />; }
        `,
      },
      { aliases: { '@': './src' } },
    );
    expect(output['./src/app.tsx']).toContain('Shell(_id + "/Shell", _id, ["ok"])');
  });

  it('rejects recursive component edges that cross modules', () => {
    expect(() =>
      compileModules({
        './a.tsx': `
          import { B } from './b';
          export function A() { return <main><B /></main>; }
        `,
        './b.tsx': `
          import { A } from './a';
          export function B() { return <main><A /></main>; }
        `,
      }),
    ).toThrowError(/recursive cross-module component graph/);
  });

  it('rejects one imported factory used both statically and as a row', () => {
    expect(() =>
      compileModules({
        './row.tsx': `
          export function Row(item) { return <p>{item.id}</p>; }
        `,
        './app.tsx': `
          import { Row } from './row';
          const rows = [{ id: 1 }];
          export function App() {
            return <main>
              <Row item={rows[0]} />
              <div>{rows.map(row => <Row key={row.id} item={row} />)}</div>
            </main>;
          }
        `,
      }),
    ).toThrowError(/used both as a keyed row and a static child/);
  });
});

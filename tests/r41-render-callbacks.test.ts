/**
 * R41 - caller-owned render callbacks cross a component boundary as compiled
 * row-factory adapters, never as runtime JSX values.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it,  } from 'bun:test';
import { compile, compileModules } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const SOURCE = `
  function List({ items, renderItem }) {
    return <ul>{items.map((item, index) => renderItem(item, index))}</ul>;
  }
  export function App() {
    let count = 0;
    let items = [
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ];
    return <main>
      <button id="count" onClick={() => count++}>count</button>
      <button id="reverse" onClick={() => items = items.toReversed()}>reverse</button>
      <button id="remove" onClick={() => items = items.slice(0, -1)}>remove</button>
      <List
        items={items}
        renderItem={(item, index) => (
          <li key={item.id}>{item.label}:{index}:{count}</li>
        )}
      />
    </main>;
  }
`;
const NESTED_SOURCE = `
  function List({ items, renderItem }) {
    return <section>{items.map(item => renderItem(item))}</section>;
  }
  let shared = 0;
  export let disposed = 0;
  function Card({ item }) {
    $cleanup(() => disposed++);
    return <button class="card" onClick={() => shared++}>
      {item.label}:{shared}
    </button>;
  }
  export function App() {
    let items = [
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ];
    return <main>
      <button id="remove" onClick={() => items = items.slice(0, -1)}>remove</button>
      <List
        items={items}
        renderItem={item => <Card key={item.id} item={item} />}
      />
    </main>;
  }
`;
const FORWARDED_SOURCE = `
  let shared = 0;
  function current() { return shared; }
  function List(props) {
    return <ul>{props.items.map((item, index) => props.renderItem(item, index))}</ul>;
  }
  function Forward({items, draw}) {
    return <List {...{items, renderItem: draw}} />;
  }
  export function App() {
    return <main>
      <button id="callback-count" onClick={() => shared++}>Count</button>
      <Forward items={[1, 2]} draw={(item, index) => <li key={item}>{item}:{index}:{current()}:{shared}</li>} />
    </main>;
  }
`;

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

describe('R41 - cross-component render callbacks', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r41-render-callbacks.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r41-render-callbacks-nested.compiled.ts'),
      compile(NESTED_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r41-render-callbacks-forwarded.compiled.ts'),
      compile(FORWARDED_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
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

  it('emits a specialized create/key adapter without runtime insertion', () => {
    const code = compile(SOURCE);
    expect(code).toContain('create:');
    expect(code).toContain('key:');
    expect(code).toContain('.createListRegion(');
    expect(code).not.toContain('insert(');
  });

  it('forwards a stable descriptor through spreads and routes direct/helper module reads', async () => {
    const { App } = await importFixture('./fixtures/out/r41-render-callbacks-forwarded.compiled.ts');
    document.body.appendChild(App('App', null));
    const rows = [...document.querySelectorAll('li')];
    expect(rows.map(row => row.textContent)).toEqual(['1:0:0:0', '2:1:0:0']);
    document.querySelector<HTMLButtonElement>('#callback-count')!.click();
    expect([...document.querySelectorAll('li')]).toEqual(rows);
    expect(rows.map(row => row.textContent)).toEqual(['1:0:1:1', '2:1:1:1']);
  });

  it('serializes the callback contract across a module boundary', () => {
    const output = compileModules({
      './List.tsx': `
        export function List({ items, renderItem }) {
          return <ul>{items.map(item => renderItem(item))}</ul>;
        }
      `,
      './App.tsx': `
        import { List } from './List';
        export function App({ items }) {
          return <List
            items={items}
            renderItem={item => <li key={item.id}>{item.label}</li>}
          />;
        }
      `,
    });
    expect(output['./List.tsx']).toContain('renderItem.create(');
    expect(output['./App.tsx']).toContain('create:');
    expect(output['./App.tsx']).toContain('key:');
  });

  it('retains keyed DOM while callee data and caller state update', async () => {
    const { App } = await importFixture(
      './fixtures/out/r41-render-callbacks.compiled.ts',
    );
    document.body.appendChild(App('App', null));
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one:0:0', 'two:1:0']);

    const one = document.querySelectorAll('li')[0]!;
    document.querySelector<HTMLButtonElement>('#count')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one:0:1', 'two:1:1']);

    document.querySelector<HTMLButtonElement>('#reverse')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two:0:1', 'one:1:1']);
    expect(document.querySelectorAll('li')[1]).toBe(one);

    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two:0:1']);
  });

  it('refreshes and disposes component trees owned by callback rows', async () => {
    const mod = await importFixture(
      './fixtures/out/r41-render-callbacks-nested.compiled.ts',
    );
    document.body.appendChild(mod.App('App', null));
    const cards = document.querySelectorAll<HTMLButtonElement>('.card');
    expect([...cards].map((node) => node.textContent?.trim())).toEqual([
      'one:0',
      'two:0',
    ]);

    cards[0]!.click();
    expect(
      [...document.querySelectorAll('.card')].map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(['one:1', 'two:1']);

    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect(document.querySelectorAll('.card').length).toBe(1);
    expect(mod.disposed).toBe(1);
  });
});

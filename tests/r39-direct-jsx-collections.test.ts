/**
 * R39 - direct compile-time JSX collections.
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
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const SOURCE = `
  function Badge({ value }) {
    return <mark id="badge">badge:{value}</mark>;
  }

  function renderPair(value) {
    return [
      <span id="pair-a">a:{value}</span>,
      <span id="pair-b">b:{value}</span>,
    ];
  }

  export function App() {
    let count = 1;
    let active = true;
    let items = [
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ];
    const leading = [
      <h1 id="count">count:{count}</h1>,
      null,
      false,
      [<Badge value={count} />],
    ];
    const views = [
      ...leading,
      active
        ? <strong id="active">active:{count}</strong>
        : <em id="inactive">inactive:{count}</em>,
      <ul>
        {items.map((item, index) => (
          <li key={item.id} data-index={index}>{item.label}:{count}</li>
        ))}
      </ul>,
    ];

    return <main>
      <button id="increment" onClick={() => count++}>increment</button>
      <button id="toggle" onClick={() => active = !active}>toggle</button>
      <button id="reverse" onClick={() => items = [...items].reverse()}>reverse</button>
      {views}
      {renderPair(count)}
      {[<footer id="inline">inline:{count}</footer>]}
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r39-direct-jsx-collections.compiled.ts';
  return import(specifier);
}

describe('R39 - direct JSX collections', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r39-direct-jsx-collections.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
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

  it('flattens aliases, nested arrays, static spreads, helpers, and inline arrays', () => {
    const code = compile(SOURCE);
    expect(code).not.toContain('const leading');
    expect(code).not.toContain('const views');
    expect(code).not.toContain('function renderPair');
    expect(code).toContain('document.createElement("h1")');
    expect(code).toContain('document.createElement("mark")');
    expect(code).toContain('document.createElement("footer")');
    expect(code).toContain('.createCondRegion(');
    expect(code).toContain('.createListRegion(');
  });

  it('updates collection content through stable conditional and keyed-list regions', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#count')?.textContent).toBe('count:1');
    expect(document.querySelector('#badge')?.textContent).toBe('badge:1');
    expect(document.querySelector('#active')?.textContent).toBe('active:1');
    expect(document.querySelector('#pair-a')?.textContent).toBe('a:1');
    expect(document.querySelector('#inline')?.textContent).toBe('inline:1');
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one:1', 'two:1']);

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#count')?.textContent).toBe('count:2');
    expect(document.querySelector('#badge')?.textContent).toBe('badge:2');
    expect(document.querySelector('#active')?.textContent).toBe('active:2');
    expect(document.querySelector('#pair-b')?.textContent).toBe('b:2');
    expect(document.querySelector('#inline')?.textContent).toBe('inline:2');

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelector('#active')).toBeNull();
    expect(document.querySelector('#inactive')?.textContent).toBe('inactive:2');

    const first = document.querySelectorAll('li')[0]!;
    document.querySelector<HTMLButtonElement>('#reverse')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two:2', 'one:2']);
    expect(document.querySelectorAll('li')[1]).toBe(first);
  });

  it('rejects dynamic array spreads that would require runtime JSX values', () => {
    expect(() =>
      compile(`
        export function App({ extra }) {
          const views = [<strong>fixed</strong>, ...extra];
          return <main>{views}</main>;
        }
      `),
    ).toThrow(/JSX array spreads must resolve to a static JSX array/);
  });
});

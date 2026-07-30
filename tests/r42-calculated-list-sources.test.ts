/**
 * R42 - calculated list sources lower through generated local derivations and
 * the existing keyed list region. JavaScript/library methods are intentionally
 * not classified by name; authors own the source expression's return value.
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
  export function App() {
    let showDone = false;
    let items = [
      { id: 1, label: "one", done: false },
      { id: 2, label: "two", done: true },
      { id: 3, label: "three", done: false },
    ];
    return <main>
      <button id="filter" onClick={() => showDone = !showDone}>filter</button>
      <button id="toggle" onClick={() => {
        items = items.map(item =>
          item.id === 1 ? { ...item, done: true } : item
        );
      }}>toggle</button>
      <button id="reverse" onClick={() => items = items.toReversed()}>reverse</button>
      <ul>
        {items
          .filter(item => item.done === showDone)
          .slice(0, 3)
          .map((item, index) => (
            <li key={item.id} data-index={index}>{item.label}</li>
          ))}
      </ul>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r42-calculated-list-sources.compiled.ts';
  return import(specifier);
}

describe('R42 - calculated list sources', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r42-calculated-list-sources.compiled.ts'),
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

  it('hoists one derivation and retains the ordinary R7 hot path', () => {
    const code = compile(SOURCE);
    expect(code).toMatch(/let _listView = items\.filter/);
    expect(code).toContain('_listView = items.filter');
    expect(code).toContain('.createListRegion(');
    expect(code).not.toContain('insert(');
  });

  it('recomputes only through the owner prelude and retains matching keys', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one', 'three']);

    const one = document.querySelectorAll('li')[0]!;
    document.querySelector<HTMLButtonElement>('#reverse')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['three', 'one']);
    expect(document.querySelectorAll('li')[1]).toBe(one);

    document.querySelector<HTMLButtonElement>('#filter')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two']);
    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two', 'one']);
  });

  it('is agnostic to standard, mutating, unknown, and future method names', () => {
    expect(
      compile(`
        export function App({ records }) {
          return <ul>{Object.values(records).map(item => <li>{item}</li>)}</ul>;
        }
      `),
    ).toContain('.createListRegion(');
    expect(
      compile(`
        export function App({ items }) {
          return <ul>{items.sort().map(item => <li>{item}</li>)}</ul>;
        }
      `),
    ).toContain('.createListRegion(');
    expect(
      compile(`
        export function App({ items }) {
          return <ul>{getItems(items).map(item => <li>{item}</li>)}</ul>;
        }
      `),
    ).toContain('.createListRegion(');
    expect(
      compile(`
        export function App({ items }) {
          return <ul>{
            items.futureCollectionOperation().map(item => <li>{item}</li>)
          }</ul>;
        }
      `),
    ).toContain('.createListRegion(');
    expect(
      compile(`
        export function App({ items }) {
          return <ul>{
            items.forEach(item => item).map(item => <li>{item}</li>)
          }</ul>;
        }
      `),
    ).toContain('.createListRegion(');
  });
});

/**
 * R7 - standard Array.map(item, index) list callbacks.
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
const fixture = join(outDir, 'r7-indexed-map.compiled.ts');

const SOURCE = `
  function Row({ item, index }) {
    return <li class="component-row">{index}:{item.id}</li>;
  }

  export function App() {
    let items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    return <main>
      <button id="reverse" onClick={() => {
        items = [...items].reverse();
      }}>reverse</button>

      <ul id="component-list">
        {items.map((item, index) =>
          <Row key={item.id} item={item} index={index} />
        )}
      </ul>

      <ol id="inline-list">
        {items.map((item, index) =>
          <li key={item.id} class="inline-row">{index}:{item.id}</li>
        )}
      </ol>

      <div id="position-keyed-list">
        {items.map((item, index) =>
          <span key={index} class="position-row">{index}:{item.id}</span>
        )}
      </div>
    </main>;
  }
`;

function texts(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map(
    (node) => node.textContent ?? '',
  );
}

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r7-indexed-map.compiled.ts';
  return import(specifier);
}

describe('R7 - indexed map callbacks', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      fixture,
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
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

  it('accepts one item identifier and one index identifier', () => {
    const code = compile(SOURCE);
    expect(code).toMatch(
      /createListRegion\([^]*?\(item, _rowId\d*, index\) =>/,
    );
    expect(code).toContain('(item, index) => index');
  });

  it('updates component and inline indices while retaining keyed rows', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(texts('.component-row')).toEqual(['0:a', '1:b', '2:c']);
    expect(texts('.inline-row')).toEqual(['0:a', '1:b', '2:c']);
    expect(texts('.position-row')).toEqual(['0:a', '1:b', '2:c']);

    const componentA = document.querySelectorAll('.component-row')[0]!;
    const inlineA = document.querySelectorAll('.inline-row')[0]!;
    const firstPosition = document.querySelectorAll('.position-row')[0]!;

    document.querySelector<HTMLButtonElement>('#reverse')!.click();

    expect(texts('.component-row')).toEqual(['0:c', '1:b', '2:a']);
    expect(texts('.inline-row')).toEqual(['0:c', '1:b', '2:a']);
    expect(texts('.position-row')).toEqual(['0:c', '1:b', '2:a']);
    expect(document.querySelectorAll('.component-row')[2]).toBe(componentA);
    expect(document.querySelectorAll('.inline-row')[2]).toBe(inlineA);
    expect(document.querySelectorAll('.position-row')[0]).toBe(firstPosition);
  });
});

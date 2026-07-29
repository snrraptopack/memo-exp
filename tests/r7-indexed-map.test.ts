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
const destructuredFixture = join(
  outDir,
  'r7-destructured-map.compiled.ts',
);

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

const DESTRUCTURED_SOURCE = `
  function Row({ id, title, index }) {
    return <li class="destructured-component">{index}:{id}:{title}</li>;
  }

  export function App() {
    let items = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ];
    return <main>
      <button id="replace" onClick={() => {
        items = [
          { id: 'b', title: 'Beta!' },
          { id: 'a', title: 'Alpha!' },
        ];
      }}>replace</button>

      <ul>{items.map(({ id, title }, index) => {
        return <Row key={id} id={id} title={title} index={index} />;
      })}</ul>

      <ol>{items.map(({ id, title }, index) =>
        <li key={id} class="destructured-inline">{index}:{id}:{title}</li>
      )}</ol>
    </main>;
  }
`;

function texts(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map(
    (node) => node.textContent ?? '',
  );
}

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('R7 - indexed map callbacks', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      fixture,
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      destructuredFixture,
      compile(DESTRUCTURED_SOURCE, {
        runtimePath: '@memoized-dom/runtime',
      }),
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

  it('accepts a block body containing a single JSX return', () => {
    const code = compile(`
      const items = [{ id: 1 }];
      export function App() {
        return <ul>{items.map((item, index) => {
          return <li key={item.id}>{index}:{item.id}</li>;
        })}</ul>;
      }
    `);
    expect(code).toContain('.createListRegion(');
    expect(code).toMatch(/\(item, _rowId\d*, index\) =>/);
  });

  it('accepts inline finite primitive arrays, including TypeScript casts', () => {
    const code = compile(`
      type Tab = "preview" | "code" | "raw";
      let selected: Tab = "preview";
      export function App() {
        return <nav>
          {(["preview", "code", "raw"] as Tab[]).map((tab) =>
            <button class={selected === tab ? "active" : ""}>{tab}</button>
          )}
        </nav>;
      }
    `);
    expect(code).toContain('.createListRegion(');
    expect(code).toContain('/$static-list');
  });

  it('accepts object and array item binding patterns', () => {
    const objectCode = compile(DESTRUCTURED_SOURCE);
    expect(objectCode).toMatch(/\(\{\s*id,\s*title\s*\}, _rowId\d*, index\) =>/);
    expect(objectCode).toMatch(
      /\(\{\s*id,\s*title\s*\}, index\) => id/,
    );

    const arrayCode = compile(`
      const entries = [['a', 'Alpha']];
      export function App() {
        return <ul>{entries.map(([id, title], index) =>
          <li key={id}>{index}:{title}</li>
        )}</ul>;
      }
    `);
    expect(arrayCode).toMatch(/\(\[id, title\], _rowId\d*, index\) =>/);
  });

  it('updates component and inline indices while retaining keyed rows', async () => {
    const { App } = await importCompiled('r7-indexed-map');
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

  it('replays destructuring for retained component and inline rows', async () => {
    const { App } = await importCompiled('r7-destructured-map');
    document.body.appendChild(App('App', null));

    expect(texts('.destructured-component')).toEqual([
      '0:a:Alpha',
      '1:b:Beta',
    ]);
    expect(texts('.destructured-inline')).toEqual([
      '0:a:Alpha',
      '1:b:Beta',
    ]);

    const componentA =
      document.querySelectorAll('.destructured-component')[0]!;
    const inlineA = document.querySelectorAll('.destructured-inline')[0]!;
    document.querySelector<HTMLButtonElement>('#replace')!.click();

    expect(texts('.destructured-component')).toEqual([
      '0:b:Beta!',
      '1:a:Alpha!',
    ]);
    expect(texts('.destructured-inline')).toEqual([
      '0:b:Beta!',
      '1:a:Alpha!',
    ]);
    expect(
      document.querySelectorAll('.destructured-component')[1],
    ).toBe(componentA);
    expect(document.querySelectorAll('.destructured-inline')[1]).toBe(
      inlineA,
    );
  });
});

/**
 * R38 - compile-time JSX-returning helpers and local render callbacks.
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
  function renderStatus(mode, message) {
    const upper = message.toUpperCase();
    if (mode === 0) return <strong id="ready">{upper}</strong>;
    if (mode === 1) return <em id="waiting">wait:{message}</em>;
    return <i id="idle">idle</i>;
  }

  export function App() {
    let mode = 0;
    let message = "first";
    let items = [
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ];
    const renderItem = (item, index) => (
      <li key={item.id} data-index={index}>{item.label}:{message}</li>
    );

    return <main>
      <button id="mode" onClick={() => mode = (mode + 1) % 3}>mode</button>
      <button id="message" onClick={() => message = "second"}>message</button>
      <button id="reverse" onClick={() => items = [...items].reverse()}>reverse</button>
      <section>{renderStatus(mode, message)}</section>
      <ul>{items.map(renderItem)}</ul>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r38-jsx-render-functions.compiled.ts';
  return import(specifier);
}

describe('R38 - JSX render functions', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r38-jsx-render-functions.compiled.ts'),
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

  it('removes render functions and lowers their JSX through normal regions', () => {
    const code = compile(SOURCE);
    expect(code).not.toContain('function renderStatus');
    expect(code).not.toContain('const renderItem');
    expect(code).toContain('document.createElement("strong")');
    expect(code).toContain('.createCondRegion(');
    expect(code).toContain('.createListRegion(');
  });

  it('keeps helper branches and callback-generated keyed rows reactive', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#ready')?.textContent).toBe('FIRST');
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one:first', 'two:first']);

    document.querySelector<HTMLButtonElement>('#message')!.click();
    expect(document.querySelector('#ready')?.textContent).toBe('SECOND');
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['one:second', 'two:second']);

    const first = document.querySelectorAll('li')[0]!;
    document.querySelector<HTMLButtonElement>('#reverse')!.click();
    expect([...document.querySelectorAll('li')].map((node) => node.textContent))
      .toEqual(['two:second', 'one:second']);
    expect(document.querySelectorAll('li')[1]).toBe(first);

    document.querySelector<HTMLButtonElement>('#mode')!.click();
    expect(document.querySelector('#ready')).toBeNull();
    expect(document.querySelector('#waiting')?.textContent).toBe('wait:second');
  });

  it('supports concise, defaulted, if/else, and switch render functions', () => {
    const code = compile(`
      const renderConcise = value => <b>{value}</b>;
      function renderDefault(value = "fallback") {
        return <strong>{value}</strong>;
      }
      function renderChoice(active) {
        if (active) return <i>yes</i>;
        else return <em>no</em>;
      }
      function renderSwitch(mode) {
        switch (mode) {
          case "a": return <u>a</u>;
          default: return <s>other</s>;
        }
      }
      export function App() {
        let active = true;
        let mode = "a";
        return <main>
          {renderConcise("value")}
          {renderDefault()}
          {renderChoice(active)}
          {renderSwitch(mode)}
        </main>;
      }
    `);
    expect(code).toContain('document.createElement("b")');
    expect(code).toContain('document.createElement("strong")');
    expect(code).toContain('document.createElement("i")');
    expect(code).toContain('document.createElement("em")');
    expect(code).toContain('document.createElement("u")');
    expect(code).toContain('document.createElement("s")');
  });

  it('rejects side-effect statements in a render function body', () => {
    expect(() =>
      compile(`
        function renderValue(value) {
          console.log(value);
          return <strong>{value}</strong>;
        }
        export function App() {
          return <main>{renderValue("value")}</main>;
        }
      `),
    ).toThrow(/JSX render functions support pure const setup/);
  });
});

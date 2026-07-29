/**
 * R29 - component-local JSX values are compile-time render aliases.
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
  function Panel({ label }) {
    return <strong id="panel">{label}</strong>;
  }

  export function App() {
    let mode = 0;
    let message = "first";
    const staticView = <p class="message">{message}</p>;
    const selectedView =
      mode === 0
        ? <Panel label={message} />
        : mode === 1
          ? "fallback:" + message
          : null;
    const aliasedView = selectedView;

    return <main>
      <button id="mode" onClick={() => mode = (mode + 1) % 3}>mode</button>
      <button id="message" onClick={() => message = "second"}>message</button>
      {staticView}
      <section id="selected">{aliasedView}</section>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r29-jsx-values.compiled.ts';
  return import(specifier);
}

describe('R29 - JSX values', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r29-jsx-values.compiled.ts'),
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

  it('supports a JSX value as the direct component return', () => {
    const code = compile(`
      export function App() {
        const view = <main id="direct">direct</main>;
        return view;
      }
    `);
    expect(code).toContain('document.createElement("main")');
    expect(code).not.toContain('const view');
  });

  it('clones a render alias at each authored use', () => {
    const code = compile(`
      export function App() {
        let count = 1;
        const badge = <span>{count}</span>;
        return <main>{badge}{badge}</main>;
      }
    `);
    expect(code.match(/document\.createElement\("span"\)/g)).toHaveLength(2);
  });

  it('rejects JSX values used as ordinary JavaScript data', () => {
    expect(() =>
      compile(`
        export function App() {
          const view = <span>value</span>;
          console.log(view);
          return <main />;
        }
      `),
    ).toThrow(/JSX value 'view' is used outside a render position/);
  });

  it('keeps static, aliased conditional, component, text, and empty values reactive', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('.message')?.textContent).toBe('first');
    expect(document.querySelector('#panel')?.textContent).toBe('first');

    document.querySelector<HTMLButtonElement>('#message')!.click();
    expect(document.querySelector('.message')?.textContent).toBe('second');
    expect(document.querySelector('#panel')?.textContent).toBe('second');

    document.querySelector<HTMLButtonElement>('#mode')!.click();
    expect(document.querySelector('#panel')).toBeNull();
    expect(document.querySelector('#selected')?.textContent).toBe(
      'fallback:second',
    );

    document.querySelector<HTMLButtonElement>('#mode')!.click();
    expect(document.querySelector('#selected')?.textContent).toBe('');
  });
});

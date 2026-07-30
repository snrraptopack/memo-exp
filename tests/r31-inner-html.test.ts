/**
 * R31 - explicit raw HTML uses guarded HTML-property updates.
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
    let markup = "<strong id='raw-value'>first</strong>";
    return <main>
      <button
        id="update"
        onClick={() => markup = "<em id='raw-value'>second</em>"}
      >
        update
      </button>
      <section id="raw" innerHTML={markup} />
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r31-inner-html.compiled.ts';
  return import(specifier);
}

describe('R31 - reactive innerHTML', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r31-inner-html.compiled.ts'),
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

  it('writes innerHTML as a property and updates it reactively', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#raw-value')?.tagName).toBe('STRONG');
    expect(document.querySelector('#raw-value')?.textContent).toBe('first');

    document.querySelector<HTMLButtonElement>('#update')!.click();
    expect(document.querySelector('#raw-value')?.tagName).toBe('EM');
    expect(document.querySelector('#raw-value')?.textContent).toBe('second');
  });

  it('supports static innerHTML without emitting an attribute write', () => {
    const code = compile(`
      export function App() {
        return <div innerHTML="<b>safe-by-author-contract</b>" />;
      }
    `);
    expect(code).toContain('.innerHTML =');
    expect(code).not.toContain('.setDomValue(');
  });

  it('rejects mixed managed children and raw HTML', () => {
    expect(() =>
      compile(`
        export function App() {
          let markup = "<b>raw</b>";
          return <div innerHTML={markup}><span>managed</span></div>;
        }
      `),
    ).toThrow(/using innerHTML cannot also have JSX children/);
  });
});

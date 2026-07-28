/**
 * R8 - text and mixed structural conditional children.
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

const SOURCE = `
  export function App() {
    let mode = 0;
    let message = 'first';
    return <main>
      <button id="next" onClick={() => mode = (mode + 1) % 3}>next</button>
      <button id="message" onClick={() => message = 'second'}>message</button>
      <section id="mixed">
        {mode === 0
          ? <strong id="element-branch">element</strong>
          : mode === 1
            ? message
            : null}
      </section>
      <p id="text-only">{mode === 0 ? 'zero' : 'other'}</p>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r8-mixed-conditional.compiled.ts';
  return import(specifier);
}

describe('R8 - mixed conditional children', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r8-mixed-conditional.compiled.ts'),
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

  it('keeps all-text ternaries as one dynamic text setter', () => {
    const code = compile(`
      export function App() {
        let enabled = true;
        return <p>{enabled ? 'yes' : 'no'}</p>;
      }
    `);
    expect(code).not.toContain('.createCondRegion(');
    expect(code).toContain("enabled ? 'yes' : 'no'");
  });

  it('switches among element, live text, and empty branches', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    const mixed = document.querySelector('#mixed')!;
    expect(document.querySelector('#element-branch')?.textContent).toBe(
      'element',
    );
    expect(document.querySelector('#text-only')?.textContent).toBe('zero');

    document.querySelector<HTMLButtonElement>('#next')!.click();
    expect(document.querySelector('#element-branch')).toBeNull();
    expect(mixed.textContent?.trim()).toBe('first');
    expect(document.querySelector('#text-only')?.textContent).toBe('other');

    document.querySelector<HTMLButtonElement>('#message')!.click();
    expect(mixed.textContent?.trim()).toBe('second');

    document.querySelector<HTMLButtonElement>('#next')!.click();
    expect(mixed.textContent?.trim()).toBe('');

    document.querySelector<HTMLButtonElement>('#next')!.click();
    expect(document.querySelector('#element-branch')?.textContent).toBe(
      'element',
    );
  });
});

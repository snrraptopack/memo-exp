/**
 * R33 - resolvable named effects and stable conditional activation.
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
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const SOURCE = `
  export function App() {
    let enabled = false;
    let count = 0;

    function synchronize() {
      console.log("run:" + count);
      return () => console.log("cleanup:" + count);
    }

    if (enabled) {
      effect(synchronize);
    }

    return <main>
      <button id="toggle" onClick={() => enabled = !enabled}>toggle</button>
      <button id="increment" onClick={() => count++}>increment</button>
      <output id="enabled">{enabled ? "on" : "off"}</output>
      <output id="count">{count}</output>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier =
    './fixtures/out/r33-named-conditional-effect.compiled.ts';
  return import(specifier);
}

describe('R33 - named and conditional effects', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r33-named-conditional-effect.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetScheduler();
    vi.restoreAllMocks();
  });

  it('lowers a named conditional effect into controller and active identities', () => {
    const code = compile(SOURCE);
    expect(code).toContain('.registerConditionalEffect(');
    expect(code).toContain('synchronize');
    expect(code).toContain('"/$effects/0"');
    expect(code).not.toContain('if (enabled)');
  });

  it('keeps the active registration stable and cleans it up on false', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(console.log).not.toHaveBeenCalled();
    expect(_internals().registry.has('App/$effects/0')).toBe(true);
    expect(_internals().registry.has('App/$effects/0/$active')).toBe(false);

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(console.log).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([['run:1']]);
    expect(_internals().registry.has('App/$effects/0/$active')).toBe(true);

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['run:1'],
      ['cleanup:2'],
      ['run:2'],
    ]);

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['run:1'],
      ['cleanup:2'],
      ['run:2'],
      ['cleanup:2'],
    ]);
    expect(_internals().registry.has('App/$effects/0/$active')).toBe(false);

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(console.log).toHaveBeenCalledTimes(4);

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(console.log).toHaveBeenLastCalledWith('run:3');
  });

  it('supports named module effects controlled by module state', () => {
    const code = compile(`
      let enabled = false;
      let count = 0;
      function synchronize() {
        console.log(count);
      }
      if (enabled) effect(synchronize);
      export function App() {
        return <button onClick={() => enabled = !enabled}>{count}</button>;
      }
    `);
    expect(code).toContain('.registerConditionalEffect(');
    expect(code).toContain('/$module-effects/');
    expect(code).toContain('/$active');
  });

  it('rejects mixed imperative work in a conditional effect branch', () => {
    expect(() =>
      compile(`
        export function App() {
          let enabled = true;
          if (enabled) {
            console.log("imperative");
            effect(() => console.log("effect"));
          }
          return <main />;
        }
      `),
    ).toThrow(/conditional effect branch may contain only/);
  });
});

/**
 * R40 - top-level const arrow/function-expression components normalize to the
 * canonical component factory pipeline.
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
  const Child = function Child({ value }) {
    let local = 0;
    return <button id="child" onClick={() => local++}>{value}:{local}</button>;
  };

  export const App = () => {
    let count = 1;
    return <main>
      <button id="parent" onClick={() => count++}>parent</button>
      <Child value={count} />
    </main>;
  };
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r40-component-expressions.compiled.ts';
  return import(specifier);
}

describe('R40 - component expressions', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r40-component-expressions.compiled.ts'),
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

  it('emits the same direct factories without runtime component wrappers', () => {
    const code = compile(SOURCE);
    expect(code).toContain('function Child(');
    expect(code).toContain('export function App(');
    expect(code).not.toContain('const Child =');
    expect(code).not.toContain('const App =');
    expect(code).toContain('document.createElement("button")');
  });

  it('retains child state while arrow-parent props update', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    const child = document.querySelector<HTMLButtonElement>('#child')!;
    expect(child.textContent).toBe('1:0');
    child.click();
    expect(child.textContent).toBe('1:1');
    document.querySelector<HTMLButtonElement>('#parent')!.click();
    expect(child.textContent).toBe('2:1');
    expect(document.querySelector('#child')).toBe(child);
  });

  it('links exported arrow components across modules', () => {
    const output = compileModules({
      './Card.tsx': `
        export const Card = ({ value }) => <article>{value}</article>;
      `,
      './App.tsx': `
        import { Card } from "./Card";
        export const App = () => {
          let value = 1;
          return <Card value={value} />;
        };
      `,
    });
    expect(output['./Card.tsx']).toContain('export function Card(');
    expect(output['./App.tsx']).toContain('export function App(');
    expect(output['./App.tsx']).toContain('Card(');
  });

  it('rejects mutable or asynchronous component identities', () => {
    expect(() =>
      compile(`export const App = async () => <main />;`),
    ).toThrow(/must be synchronous/);
    expect(() =>
      compile(`
        let App = () => <main />;
        export { App };
      `),
    ).toThrow(/JSX outside a component/);
  });
});

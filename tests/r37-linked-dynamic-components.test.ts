/**
 * R37 - finite component candidates through linked helpers and registries.
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
const linkedOutDir = join(here, 'fixtures', 'out', 'r37-linked');
const LINKED_SOURCE = {
  './views.tsx': `
    export function Preview({ value }) {
      return <p id="preview">preview:{value}</p>;
    }
    export function Code({ value }) {
      return <pre id="code">code:{value}</pre>;
    }
    export function selectView(mode) {
      return mode === "preview" ? Preview : Code;
    }
  `,
  './App.tsx': `
    import { selectView } from "./views";
    export function App() {
      let mode = "preview";
      let value = 1;
      const View = selectView(mode);
      return <main>
        <button id="mode" onClick={() => mode = mode === "preview" ? "code" : "preview"}>mode</button>
        <button id="value" onClick={() => value++}>value</button>
        <View value={value} />
      </main>;
    }
  `,
};

function importLinkedApp(): Promise<any> {
  const specifier = './fixtures/out/r37-linked/App.tsx';
  return import(specifier);
}

describe('R37 - linked dynamic components', () => {
  beforeAll(() => {
    const output = compileModules(LINKED_SOURCE, {
      runtimePath: '@memoized-dom/runtime',
    });
    mkdirSync(linkedOutDir, { recursive: true });
    writeFileSync(join(linkedOutDir, 'views.tsx'), output['./views.tsx']);
    writeFileSync(join(linkedOutDir, 'App.tsx'), output['./App.tsx']);
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

  it('supports a computed local component registry', () => {
    const code = compile(`
      function Preview({ value }) { return <p>preview:{value}</p>; }
      function Code({ value }) { return <pre>code:{value}</pre>; }
      export function App() {
        let mode = "preview";
        let value = 1;
        const views = { preview: Preview, code: Code };
        const View = views[mode];
        return <View value={value} />;
      }
    `);
    expect(code).toContain('Preview');
    expect(code).toContain('Code');
    expect(code).toContain('.createCondRegion(');
  });

  it('synthesizes candidate imports for a component-returning helper', () => {
    const output = compileModules({
      './views.tsx': `
        export function Preview({ value }) {
          return <p>preview:{value}</p>;
        }
        export function Code({ value }) {
          return <pre>code:{value}</pre>;
        }
        export function selectView(mode) {
          return mode === "preview" ? Preview : Code;
        }
      `,
      './App.tsx': `
        import { selectView } from "./views";
        export function App() {
          let mode = "preview";
          let value = 1;
          const View = selectView(mode);
          return <View value={value} />;
        }
      `,
    });
    const app = output['./App.tsx'];
    expect(app).toMatch(
      /import \{ (?:Preview|Code) as MDDynamic_(?:Preview|Code) \} from "\.\/views\.tsx";/,
    );
    expect(app).toContain('MDDynamic_Preview(');
    expect(app).toContain('MDDynamic_Code(');
    expect(app).toContain('.createCondRegion(');
  });

  it('synthesizes candidates for an imported component registry', () => {
    const output = compileModules({
      './views.tsx': `
        export function Preview() { return <p>preview</p>; }
        export function Code() { return <pre>code</pre>; }
        export const VIEWS = { preview: Preview, code: Code };
      `,
      './App.tsx': `
        import { VIEWS } from "./views";
        export function App() {
          let mode = "preview";
          const View = VIEWS[mode];
          return <View />;
        }
      `,
    });
    const app = output['./App.tsx'];
    expect(app).toContain('MDDynamic_Preview');
    expect(app).toContain('MDDynamic_Code');
    expect(app).toContain('.createCondRegion(');
  });

  it('requires every cross-module candidate to be exported', () => {
    expect(() =>
      compileModules({
        './views.tsx': `
          function Hidden() { return <p>hidden</p>; }
          export function selectView() { return Hidden; }
        `,
        './App.tsx': `
          import { selectView } from "./views";
          export function App() {
            const View = selectView();
            return <View />;
          }
        `,
      }),
    ).toThrow(/dynamic component candidate.*is not exported/);
  });

  it('switches linked component candidates and refreshes retained props at runtime', async () => {
    const { App } = await importLinkedApp();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#preview')?.textContent).toBe('preview:1');
    document.querySelector<HTMLButtonElement>('#value')!.click();
    expect(document.querySelector('#preview')?.textContent).toBe('preview:2');

    document.querySelector<HTMLButtonElement>('#mode')!.click();
    expect(document.querySelector('#preview')).toBeNull();
    expect(document.querySelector('#code')?.textContent).toBe('code:2');

    document.querySelector<HTMLButtonElement>('#value')!.click();
    expect(document.querySelector('#code')?.textContent).toBe('code:3');
  });
});

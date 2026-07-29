/**
 * R36 - JSX values through render props and finite local collections.
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
  function Frame({ heading, body, footer }) {
    return <section>
      <header>{heading}</header>
      <div id="body">{body}</div>
      <footer>{footer}</footer>
    </section>;
  }

  function Wrapper({ body }) {
    return <Frame
      heading={<h2>Wrapped</h2>}
      body={body}
      footer={<small>Forwarded</small>}
    />;
  }

  export function App() {
    let mode = 0;
    let count = 1;
    const bodies = {
      empty: <em id="empty">empty:{count}</em>,
      full: <strong id="full">full:{count}</strong>,
    };
    const footers = [
      <i id="first-footer">first</i>,
      <b id="second-footer">second</b>,
    ];
    const selectedBody = bodies[mode === 0 ? "empty" : "full"];

    return <main>
      <button id="mode" onClick={() => mode = mode === 0 ? 1 : 0}>mode</button>
      <button id="count" onClick={() => count++}>count</button>
      <Frame
        heading={<h1 id="heading">Count {count}</h1>}
        body={selectedBody}
        footer={footers[mode]}
      />
      <Wrapper body={<mark id="forwarded">value:{count}</mark>} />
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r36-jsx-render-props.compiled.ts';
  return import(specifier);
}

describe('R36 - JSX render props', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r36-jsx-render-props.compiled.ts'),
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

  it('mounts direct, object-selected, array-selected, and forwarded JSX slots', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#heading')?.textContent).toBe('Count 1');
    expect(document.querySelector('#empty')?.textContent).toBe('empty:1');
    expect(document.querySelector('#full')).toBeNull();
    expect(document.querySelector('#first-footer')).not.toBeNull();
    expect(document.querySelector('#forwarded')?.textContent).toBe('value:1');

    document.querySelector<HTMLButtonElement>('#count')!.click();
    expect(document.querySelector('#heading')?.textContent).toBe('Count 2');
    expect(document.querySelector('#empty')?.textContent).toBe('empty:2');
    expect(document.querySelector('#forwarded')?.textContent).toBe('value:2');

    document.querySelector<HTMLButtonElement>('#mode')!.click();
    expect(document.querySelector('#empty')).toBeNull();
    expect(document.querySelector('#full')?.textContent).toBe('full:2');
    expect(document.querySelector('#first-footer')).toBeNull();
    expect(document.querySelector('#second-footer')).not.toBeNull();
  });

  it('serializes render-prop contracts through the module linker', () => {
    const output = compileModules({
      './Frame.tsx': `
        export function Frame({ content }) {
          return <article>{content}</article>;
        }
      `,
      './App.tsx': `
        import { Frame } from "./Frame";
        export function App() {
          let count = 1;
          return <Frame content={<strong>{count}</strong>} />;
        }
      `,
    });
    expect(output['./App.tsx']).toContain('childrenParent');
    expect(output['./App.tsx']).toContain('document.createElement("strong")');
  });

  it('keeps an untyped cross-module sole interpolation scalar when callers supply text', () => {
    const output = compileModules({
      './Label.tsx': `
        export function Label({ text }) {
          return <strong>{text}</strong>;
        }
      `,
      './App.tsx': `
        import { Label } from "./Label";
        export function App() {
          let text = "ready";
          return <Label text={text} />;
        }
      `,
    });
    expect(output['./Label.tsx']).not.toContain('childrenParent');
    expect(output['./Label.tsx']).toContain('document.createTextNode("")');
  });

  it('rejects one cross-module prop used as both scalar and JSX content', () => {
    expect(() =>
      compileModules({
        './Slot.tsx': `
          export function Slot({ content }) {
            return <div>{content}</div>;
          }
        `,
        './App.tsx': `
          import { Slot } from "./Slot";
          export function App() {
            return <main>
              <Slot content="plain" />
              <Slot content={<strong>structured</strong>} />
            </main>;
          }
        `,
      }),
    ).toThrow(/used as both scalar data and JSX content/);
  });

  it('rejects JSX passed to a scalar prop the callee never renders', () => {
    expect(() =>
      compile(`
        function Sink({ value }) {
          return <output>{String(value)}</output>;
        }
        export function App() {
          return <Sink value={<strong>not scalar</strong>} />;
        }
      `),
    ).toThrow(/JSX prop 'value'.*is not rendered by the callee/);
  });
});

/**
 * R27 - component render preludes and source-level control flow.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

describe('R27 - render-prelude code generation', () => {
  it('replays exhaustive pure if calculations before DOM writes', () => {
    const code = compile(`
      export function App() {
        let count = 0;
        let label = '';
        if (count % 2 === 0) label = 'even';
        else label = 'odd';
        return <button onClick={() => count++}>{label}</button>;
      }
    `);
    const update = code.indexOf('const _update');
    const replay = code.indexOf('if (count % 2 === 0)', update);
    const textWrite = code.indexOf('.data =', update);
    expect(replay).toBeGreaterThan(update);
    expect(textWrite).toBeGreaterThan(replay);
  });

  it('retains imperative reactive gates as one-time setup', () => {
    const code = compile(`
      let enabled = true;
      function connect() {}
      export function App() {
        if (enabled) connect();
        return <p>{enabled ? 'on' : 'off'}</p>;
      }
    `);
    expect(code.match(/connect\(\)/g)).toHaveLength(2);
    const update = code.indexOf('const _update');
    expect(code.indexOf('connect()', update)).toBe(-1);
  });
});

const SOURCES: Record<string, string> = {
  'r27-if-order': `
    export function App() {
      let count = 1;
      let unrelated = 0;
      const doubled = count * 2;
      let label = '';
      if (doubled > 2) {
        label = 'big';
      } else {
        label = 'small';
      }
      const message = label + ':' + doubled;
      return <main>
        <button id="count" onClick={() => count++}>count</button>
        <button id="other" onClick={() => unrelated++}>other</button>
        <output>{message}:{unrelated}</output>
      </main>;
    }
  `,
  'r27-switch': `
    export function App() {
      let status = 0;
      let label = '';
      switch (status) {
        case 0:
          label = 'idle';
          break;
        case 1:
          label = 'running';
          break;
        default:
          label = 'done';
      }
      return <button onClick={() => status++}>{label}</button>;
    }
  `,
  'r27-early-return': `
    function Waiting() {
      return <p id="waiting-view">waiting</p>;
    }
    export function App() {
      let phase = 0;
      if (phase === 0) {
        return <section>
          <button id="next" onClick={() => phase++}>next</button>
          <Waiting />
        </section>;
      }
      if (phase === 1) {
        return <button id="retry" onClick={() => phase++}>retry</button>;
      }
      return <main id="ready">ready</main>;
    }
  `,
  'r27-return-switch': `
    export function App() {
      let mode = 'summary';
      switch (mode) {
        case 'summary':
          return <button id="details" onClick={() => mode = 'details'}>summary</button>;
        case 'details':
          return <button id="finish" onClick={() => mode = 'done'}>details</button>;
        default:
          return <article id="done">done</article>;
      }
    }
  `,
  'r27-effect-gate': `
    export function App() {
      let enabled = false;
      let unrelated = 0;
      effect(() => {
        if (!enabled) return;
        console.log('connect');
        return () => console.log('disconnect');
      });
      return <main>
        <button id="toggle" onClick={() => enabled = !enabled}>toggle</button>
        <button id="effect-other" onClick={() => unrelated++}>other</button>
        <output>{unrelated}</output>
      </main>;
    }
  `,
  'r27-chained-ternary': `
    function First({ onNext }) {
      return <button id="first" onClick={onNext}>first</button>;
    }
    function Second({ onNext }) {
      return <button id="second" onClick={onNext}>second</button>;
    }
    function Third() {
      return <article id="third">third</article>;
    }
    export function App() {
      let step = 1;
      return <main>
        {step === 1
          ? <First onNext={() => step = 2} />
          : step === 2
            ? <Second onNext={() => step = 3} />
            : <Third />}
      </main>;
    }
  `,
  'r27-return-with-condition': `
    function Editing({ onBusy }) {
      return <button id="busy" onClick={onBusy}>busy</button>;
    }
    function Preview() {
      return <p id="preview">preview</p>;
    }
    export function App() {
      let busy = false;
      let editing = true;
      if (busy) {
        return <button id="resume" onClick={() => busy = false}>resume</button>;
      }
      const toggle = () => { editing = !editing; };
      return <main>
        <button id="toggle-view" onClick={toggle}>toggle</button>
        {editing
          ? <Editing onBusy={() => busy = true} />
          : <Preview />}
      </main>;
    }
  `,
};

describe('R27 - compiled render preludes', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, source] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(source, { runtimePath: '@memoized-dom/runtime' }),
      );
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetScheduler();
    vi.restoreAllMocks();
  });

  it('replays const/if/const chains in source order', async () => {
    const { App } = await importCompiled('r27-if-order');
    document.body.appendChild(App('App', null));
    const output = document.querySelector('output')!;
    expect(output.textContent).toBe('small:2:0');
    document.querySelector<HTMLButtonElement>('#count')!.click();
    expect(output.textContent).toBe('big:4:0');
    document.querySelector<HTMLButtonElement>('#other')!.click();
    expect(output.textContent).toBe('big:4:1');
  });

  it('replays exhaustive switches reactively', async () => {
    const { App } = await importCompiled('r27-switch');
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('idle');
    button.click();
    expect(button.textContent).toBe('running');
    button.click();
    expect(button.textContent).toBe('done');
  });

  it('lowers JSX early-return chains to one stable switching region', async () => {
    const { App } = await importCompiled('r27-early-return');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#waiting-view')?.textContent).toBe('waiting');
    expect(_internals().registry.has('App/Waiting')).toBe(true);

    document.querySelector<HTMLButtonElement>('#next')!.click();
    expect(document.querySelector('#waiting-view')).toBeNull();
    expect(document.querySelector('#retry')?.textContent).toBe('retry');
    expect(_internals().registry.has('App/Waiting')).toBe(false);

    document.querySelector<HTMLButtonElement>('#retry')!.click();
    expect(document.querySelector('#ready')?.textContent).toBe('ready');
  });

  it('lowers exhaustive JSX-returning switches without factory rerenders', async () => {
    const { App } = await importCompiled('r27-return-switch');
    document.body.appendChild(App('App', null));
    document.querySelector<HTMLButtonElement>('#details')!.click();
    expect(document.querySelector('#finish')?.textContent).toBe('details');
    document.querySelector<HTMLButtonElement>('#finish')!.click();
    expect(document.querySelector('#done')?.textContent).toBe('done');
  });

  it('uses one stable effect for reactive imperative acquisition', async () => {
    const { App } = await importCompiled('r27-effect-gate');
    document.body.appendChild(App('App', null));
    expect(console.log).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([['connect']]);

    document.querySelector<HTMLButtonElement>('#effect-other')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([['connect']]);

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['connect'],
      ['disconnect'],
    ]);
  });

  it('flattens chained JSX ternaries into one multi-branch region', async () => {
    const { App } = await importCompiled('r27-chained-ternary');
    document.body.appendChild(App('App', null));

    document.querySelector<HTMLButtonElement>('#first')!.click();
    expect(document.querySelector('#first')).toBeNull();
    expect(document.querySelector('#second')?.textContent).toBe('second');

    document.querySelector<HTMLButtonElement>('#second')!.click();
    expect(document.querySelector('#second')).toBeNull();
    expect(document.querySelector('#third')?.textContent).toBe('third');
  });

  it('disposes a conditional nested in an early-return branch', async () => {
    const { App } = await importCompiled('r27-return-with-condition');
    document.body.appendChild(App('App', null));
    expect(_internals().registry.has('App/when0')).toBe(true);

    document.querySelector<HTMLButtonElement>('#toggle-view')!.click();
    expect(document.querySelector('#preview')?.textContent).toBe('preview');

    document.querySelector<HTMLButtonElement>('#toggle-view')!.click();
    document.querySelector<HTMLButtonElement>('#busy')!.click();
    expect(document.querySelector('#resume')?.textContent).toBe('resume');
    expect(_internals().registry.has('App/when0')).toBe(false);

    document.querySelector<HTMLButtonElement>('#resume')!.click();
    expect(document.querySelector('#toggle-view')).not.toBeNull();
    expect(_internals().registry.has('App/when0')).toBe(true);
  });
});

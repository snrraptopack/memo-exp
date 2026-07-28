/**
 * R28 - reactive pure module-level if/switch derivations.
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
import { compile, compileModules } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const graphDir = join(outDir, 'r28-graph');

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

function importGraphApp(): Promise<any> {
  const specifier = './fixtures/out/r28-graph/app.ts';
  return import(specifier);
}

function spyRenders(id: string): () => number {
  const entity = _internals().registry.get(id)!;
  let renders = 0;
  const original = entity.render;
  entity.render = () => {
    renders++;
    original();
  };
  return () => renders;
}

describe('R28 - module control-flow generation', () => {
  it('emits one computed entity for an exhaustive if assignment', () => {
    const code = compile(`
      let count = 0;
      export let parity = '';
      if (count % 2 === 0) parity = 'even';
      else parity = 'odd';
      export function App() { return <p>{parity}</p>; }
    `);

    expect(code).toContain('#$flow0');
    expect(code).toContain('depth: -1');
    expect(code).toMatch(
      /\.computedChanged\(_parityPrevious\d*, parity\)/,
    );
    expect(code).toContain(
      '"./component.tsx#count": ["App/$computed/.%2Fcomponent.tsx#$flow0"]',
    );
  });

  it('rejects writes outside the compiler-owned derivation', () => {
    expect(() =>
      compile(`
        let count = 0;
        let parity = '';
        if (count % 2 === 0) parity = 'even';
        else parity = 'odd';
        function App() {
          return <button onClick={() => parity = 'forced'}>{parity}</button>;
        }
      `),
    ).toThrowError(/cannot assign .*computed 'parity'/);
  });
});

const LOCAL_SOURCE = `
  export let count = 0;
  export let parity = '';
  if (count % 2 === 0) {
    parity = 'even';
  } else {
    parity = 'odd';
  }

  function Count() {
    return <output id="count">{count}</output>;
  }
  function Parity() {
    return <output id="parity">{parity}</output>;
  }
  function Controls() {
    return <nav>
      <button id="plus-two" onClick={() => count += 2}>+2</button>
      <button id="plus-one" onClick={() => count += 1}>+1</button>
    </nav>;
  }
  export function App() {
    return <main>
      <Controls />
      <Count />
      <Parity />
    </main>;
  }
`;

const GRAPH = {
  './state.ts': `
    export let count = 0;
    export function increment() { count++; }
  `,
  './derived.ts': `
    import { count } from './state';
    export let category = '';
    switch (count) {
      case 0:
      case 1:
        category = 'low';
        break;
      default:
        category = 'high';
    }
  `,
  './app.tsx': `
    import { increment } from './state';
    import { category } from './derived';
    function Controls() {
      return <button id="increment" onClick={() => increment()}>increment</button>;
    }
    function Category() {
      return <output id="category">{category}</output>;
    }
    export function App() {
      return <main>
        <Controls />
        <Category />
      </main>;
    }
  `,
};

describe('R28 - module control-flow execution', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r28-local.compiled.ts'),
      compile(LOCAL_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );

    mkdirSync(graphDir, { recursive: true });
    const output = compileModules(GRAPH, {
      runtimePath: '@memoized-dom/runtime',
    });
    writeFileSync(join(graphDir, 'state.ts'), output['./state.ts']!);
    writeFileSync(join(graphDir, 'derived.ts'), output['./derived.ts']!);
    writeFileSync(join(graphDir, 'app.ts'), output['./app.tsx']!);
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

  it('suppresses downstream renders when the selected value is unchanged', async () => {
    const { App } = await importCompiled('r28-local');
    document.body.appendChild(App('App', null));
    const parityRenders = spyRenders('App/Parity');

    document.querySelector<HTMLButtonElement>('#plus-two')!.click();
    expect(document.querySelector('#count')!.textContent).toBe('2');
    expect(document.querySelector('#parity')!.textContent).toBe('even');
    expect(parityRenders()).toBe(0);

    document.querySelector<HTMLButtonElement>('#plus-one')!.click();
    expect(document.querySelector('#parity')!.textContent).toBe('odd');
    expect(parityRenders()).toBe(1);
  });

  it('links an imported source through an exported switch result', async () => {
    const { App } = await importGraphApp();
    document.body.appendChild(App('App', null));
    const categoryRenders = spyRenders('App/Category');

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#category')!.textContent).toBe('low');
    expect(categoryRenders()).toBe(0);

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#category')!.textContent).toBe('high');
    expect(categoryRenders()).toBe(1);
  });
});

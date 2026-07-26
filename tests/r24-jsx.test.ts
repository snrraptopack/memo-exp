/**
 * R24 verifies authored JSX semantics that must survive guarded updates.
 *
 * The first batch focuses on reactive prop projections: parameter and body
 * destructuring, defaults, aliases, nesting, rest, and cross-module metadata.
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
import { compileModules } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const PARAMETER_SOURCE = `
  let count = 1;
  function Child({
    value: current,
    nested: { label = "fallback" } = {},
    ...rest
  }) {
    const summary = current + ":" + label + ":" + rest.extra;
    return <output id="value">{summary}</output>;
  }
  export function App() {
    return <main>
      <button id="increment" onClick={() => count++}>increment</button>
      <Child value={count} nested={{ label: "n" + count }} extra={count * 2} />
    </main>;
  }
`;

const BODY_SOURCE = `
  let count = 1;
  function Child(props) {
    const { payload, suffix = "!" } = props;
    const { value: current = 0 } = payload;
    const summary = current + suffix;
    return <output id="body-value">{summary}</output>;
  }
  export function App() {
    return <main>
      <button id="body-increment" onClick={() => count++}>increment</button>
      <Child payload={{ value: count }} />
    </main>;
  }
`;

const DEFAULT_SOURCE = `
  function Positional(value = "positional-default") {
    return <output id="positional">{value}</output>;
  }
  function ObjectDefault({ value = "object-default" }) {
    return <output id="object">{value}</output>;
  }
  function WholeDefault({ value } = { value: "whole-default" }) {
    return <output id="whole">{value}</output>;
  }
  export function App() {
    return <main>
      <Positional />
      <ObjectDefault />
      <WholeDefault />
    </main>;
  }
`;

const FRAGMENT_SOURCE = `
  let count = 1;
  let items = [{ id: 1, label: "a" }, { id: 2, label: "b" }];
  function Row({ item }) {
    return <><span class="label">{item.label}</span><em>!</em></>;
  }
  export function App() {
    return <>
      <button id="fragment-increment" onClick={() => count++}>{count}</button>
      <main>
        <>before{items.map(item =>
          <Row key={item.id} item={item} />
        )}after</>
      </main>
      <button id="fragment-remove" onClick={() => items.pop()}>remove</button>
    </>;
  }
`;

const SPREAD_SOURCE = `
  let count = 1;
  const behavior = {
    onClick: () => count++,
    id: "from-spread"
  };
  function ObjectChild({ value, enabled = false }) {
    return <output id="object-child">{value}:{enabled ? "yes" : "no"}</output>;
  }
  function PositionalChild(value, enabled) {
    return <output id="positional-child">{value}:{enabled ? "yes" : "no"}</output>;
  }
  export function App() {
    return <main>
      <label htmlFor="field">field</label>
      <button
        {...behavior}
        id="spread-button"
        class={["base", { odd: count % 2 === 1 }]}
        style={{ width: count * 10, opacity: 0.5, "--count": count }}
        tabIndex={count}
      >{count}</button>
      <ObjectChild {...{ value: count }} enabled={count > 1} />
      <PositionalChild {...{ enabled: count > 1, value: count }} />
    </main>;
  }
`;

const SVG_SOURCE = `
  let width = 2;
  function Icon({ width }) {
    return <g class={["icon", { wide: width > 2 }]}>
      <path strokeWidth={width} strokeLinecap="round" fillRule="evenodd" />
    </g>;
  }
  export function App() {
    return <main>
      <button id="widen" onClick={() => width++}>widen</button>
      <svg
        id="drawing"
        viewBox="0 0 10 10"
        style={{ width: 20, height: 20 }}
      >
        <Icon width={width} />
        <foreignObject x="0" y="0" width="10" height="10">
          <div id="foreign-html" className={{ embedded: true }}>html</div>
        </foreignObject>
      </svg>
    </main>;
  }
`;

const ROW_CHILDREN_SOURCE = `
  let items = [
    { id: 1, label: "a" },
    { id: 2, label: "b" }
  ];
  function Badge({ label }) {
    return <span class="badge">{label}</span>;
  }
  function Frame({ item, children }) {
    let taps = 0;
    return <article data-id={item.id}>
      <button class="tap" onClick={() => taps++}>{taps}</button>
      <strong>{item.label}</strong>
      <section>{children}</section>
    </article>;
  }
  export function App() {
    return <main>
      <button id="mutate-row" onClick={() => items[0].label = "A"}>mutate</button>
      <button id="replace-row" onClick={() => items[0] = { id: 1, label: "R" }}>replace</button>
      {items.map(item =>
        <Frame key={item.id} {...{ item }}>
          <Badge label={item.label} />
          <i>{item.id}</i>
        </Frame>
      )}
    </main>;
  }
`;

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

describe('R24 - authored JSX semantics', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r24-parameter.compiled.ts'),
      compile(PARAMETER_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-body.compiled.ts'),
      compile(BODY_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-default.compiled.ts'),
      compile(DEFAULT_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-fragment.compiled.ts'),
      compile(FRAGMENT_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-spread.compiled.ts'),
      compile(SPREAD_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-svg.compiled.ts'),
      compile(SVG_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
    writeFileSync(
      join(outDir, 'r24-row-children.compiled.ts'),
      compile(ROW_CHILDREN_SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((commit) => commit());
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('replays parameter aliases, nesting, defaults, and rest', async () => {
    const { App } = await importFixture(
      './fixtures/out/r24-parameter.compiled.ts',
    );
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#value')!.textContent).toBe('1:n1:2');

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#value')!.textContent).toBe('2:n2:4');
  });

  it('replays chained body destructuring before dependent derivations', async () => {
    const { App } = await importFixture('./fixtures/out/r24-body.compiled.ts');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#body-value')!.textContent).toBe('1!');

    document.querySelector<HTMLButtonElement>('#body-increment')!.click();
    expect(document.querySelector('#body-value')!.textContent).toBe('2!');
  });

  it('applies missing positional and object-property defaults', async () => {
    const { App } = await importFixture('./fixtures/out/r24-default.compiled.ts');
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#positional')!.textContent).toBe(
      'positional-default',
    );
    expect(document.querySelector('#object')!.textContent).toBe(
      'object-default',
    );
    expect(document.querySelector('#whole')!.textContent).toBe(
      'whole-default',
    );
  });

  it('keeps a destructured binding compiler-read-only', () => {
    expect(() =>
      compile(`
        function Child(props) {
          const { value } = props;
          return <button onClick={() => value++}>{value}</button>;
        }
        function App() { return <Child value={1} />; }
      `),
    ).toThrowError(/cannot update per-instance derivation 'value'/);
  });

  it('links a closed destructured prop contract across modules', () => {
    const output = compileModules({
      '/Child.tsx': `
        export function Child({ value = "default" }) {
          return <output>{value}</output>;
        }
      `,
      '/App.tsx': `
        import { Child } from "./Child";
        export function App() { return <main><Child value={"linked"} /></main>; }
      `,
    });
    expect(output['/App.tsx']).toMatch(
      /Child\(_id\d* \+ "\/Child", _id\d*, \[\{\s*value: "linked"\s*\}\]\)/,
    );
    const defaultOutput = compileModules({
      '/Child.tsx': `
        export function Child({ value } = { value: "linked-default" }) {
          return <output>{value}</output>;
        }
      `,
      '/App.tsx': `
        import { Child } from "./Child";
        export function App() { return <Child />; }
      `,
    });
    expect(defaultOutput['/App.tsx']).toMatch(
      /Child\(_id\d* \+ "\/Child", _id\d*, \[undefined\]\)/,
    );
    expect(() =>
      compileModules({
        '/Child.tsx': `
          export function Child({ value }) { return <output>{value}</output>; }
        `,
        '/App.tsx': `
          import { Child } from "./Child";
          export function App() { return <Child typo={1} />; }
        `,
      }),
    ).toThrowError(/unknown prop 'typo'/);
  });

  it('renders reactive root/nested fragments and tracks multi-node rows', async () => {
    const { App } = await importFixture(
      './fixtures/out/r24-fragment.compiled.ts',
    );
    document.body.appendChild(App('App', null));
    const increment =
      document.querySelector<HTMLButtonElement>('#fragment-increment')!;
    expect(increment.textContent).toBe('1');
    expect(document.querySelector('main')!.textContent).toBe(
      'beforea!b!after',
    );

    increment.click();
    expect(increment.textContent).toBe('2');
    document.querySelector<HTMLButtonElement>('#fragment-remove')!.click();
    expect(document.querySelector('main')!.textContent).toBe('beforea!after');
    expect(document.querySelectorAll('main em')).toHaveLength(1);
  });

  it('patches ordered host/component spreads and rich DOM values', async () => {
    const { App } = await importFixture('./fixtures/out/r24-spread.compiled.ts');
    document.body.appendChild(App('App', null));
    const button = document.querySelector<HTMLButtonElement>('#spread-button')!;
    expect(button).toBeTruthy();
    expect(button.textContent).toBe('1');
    expect(button.className).toBe('base odd');
    expect(button.style.width).toBe('10px');
    expect(button.style.opacity).toBe('0.5');
    expect(button.style.getPropertyValue('--count')).toBe('1');
    expect(button.tabIndex).toBe(1);
    expect(document.querySelector('label')!.htmlFor).toBe('field');
    expect(document.querySelector('#object-child')!.textContent).toBe(
      '1:no',
    );
    expect(document.querySelector('#positional-child')!.textContent).toBe(
      '1:no',
    );

    button.click();
    expect(button.textContent).toBe('2');
    expect(button.className).toBe('base');
    expect(button.style.width).toBe('20px');
    expect(button.style.getPropertyValue('--count')).toBe('2');
    expect(button.tabIndex).toBe(2);
    expect(document.querySelector('#object-child')!.textContent).toBe(
      '2:yes',
    );
    expect(document.querySelector('#positional-child')!.textContent).toBe(
      '2:yes',
    );
  });

  it('creates SVG namespaces and maps SVG/HTML attributes correctly', async () => {
    const { App } = await importFixture('./fixtures/out/r24-svg.compiled.ts');
    document.body.appendChild(App('App', null));
    const svg = document.querySelector('#drawing')!;
    const group = document.querySelector('g')!;
    const path = document.querySelector('path')!;
    const html = document.querySelector('#foreign-html')!;

    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(group.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(html.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect((svg as SVGElement).style.width).toBe('20px');
    expect(html.getAttribute('class')).toBe('embedded');

    document.querySelector<HTMLButtonElement>('#widen')!.click();
    expect(path.getAttribute('stroke-width')).toBe('3');
    expect(group.getAttribute('class')).toBe('icon wide');
  });

  it('owns keyed component children per row and replays the current item', async () => {
    const { App } = await importFixture(
      './fixtures/out/r24-row-children.compiled.ts',
    );
    document.body.appendChild(App('App', null));
    const rows = () => Array.from(document.querySelectorAll('article'));

    expect(rows().map((row) => row.textContent)).toEqual(['0aa1', '0bb2']);
    rows()[0]!.querySelector<HTMLButtonElement>('.tap')!.click();
    expect(rows()[0]!.querySelector('.tap')!.textContent).toBe('1');

    document.querySelector<HTMLButtonElement>('#mutate-row')!.click();
    expect(rows()[0]!.querySelector('strong')!.textContent).toBe('A');
    expect(rows()[0]!.querySelector('.badge')!.textContent).toBe('A');
    expect(rows()[0]!.querySelector('.tap')!.textContent).toBe('1');

    document.querySelector<HTMLButtonElement>('#replace-row')!.click();
    expect(rows()[0]!.querySelector('strong')!.textContent).toBe('R');
    expect(rows()[0]!.querySelector('.badge')!.textContent).toBe('R');
    expect(rows()[0]!.querySelector('.tap')!.textContent).toBe('1');
  });
});

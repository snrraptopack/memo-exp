/**
 * R21 verifies compiler-owned component children content slots.
 *
 * Slots mount lazily into the callee host while updates remain owned by the
 * lexical component. Coverage includes forwarding, nested entities, cleanup,
 * and structural list/conditional regions.
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
  has,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCES: Record<string, string> = {
  'r21-positional': `
    function Frame(children) {
      return <section>{children}</section>;
    }
    export function App() {
      let count = 0;
      return <Frame>
        <button onClick={() => count++}>{count}</button>
      </Frame>;
    }
  `,
  'r21-object': `
    function Card(props) {
      return <article>{props.children}</article>;
    }
    export function App() {
      let count = 1;
      return <Card>
        <button onClick={() => count++}>inc</button>
        <strong>{count * 2}</strong>
      </Card>;
    }
  `,
  'r21-lazy': `
    export let created = 0;
    function Worker() {
      created++;
      return <b>worker</b>;
    }
    function Sink(props) {
      return <aside>empty</aside>;
    }
    export function App() {
      return <Sink><Worker /></Sink>;
    }
  `,
  'r21-entity': `
    export let disposed = 0;
    let shared = 0;
    function Worker() {
      let count = 0;
      cleanup(() => disposed++);
      return <button onClick={() => {
        count++;
        shared++;
      }}>{count}:{shared}</button>;
    }
    function Frame(props) {
      return <div>{props.children}</div>;
    }
    export function App() {
      return <Frame><Worker /></Frame>;
    }
  `,
  'r21-regions': `
    const rows = [{ id: 1 }, { id: 2 }];
    let shown = true;
    function Frame(props) {
      return <section>{props.children}</section>;
    }
    export function App() {
      return <Frame>
        <button id="remove" onClick={() => rows.pop()}>remove</button>
        <button id="toggle" onClick={() => shown = !shown}>toggle</button>
        {rows.map(row => <span key={row.id}>{row.id}</span>)}
        {shown ? <em>shown</em> : <i>hidden</i>}
      </Frame>;
    }
  `,
  'r21-forward': `
    function Inner(props) {
      return <div>{props.children}</div>;
    }
    function Outer(props) {
      return <Inner>{props.children}</Inner>;
    }
    export function App() {
      let count = 0;
      return <Outer>
        <button onClick={() => count++}>{count}</button>
      </Outer>;
    }
  `,
};

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

const IMPORTS: Record<string, () => Promise<any>> = {
  'r21-positional': () =>
    importFixture('./fixtures/out/r21-positional.compiled.ts'),
  'r21-object': () =>
    importFixture('./fixtures/out/r21-object.compiled.ts'),
  'r21-lazy': () =>
    importFixture('./fixtures/out/r21-lazy.compiled.ts'),
  'r21-entity': () =>
    importFixture('./fixtures/out/r21-entity.compiled.ts'),
  'r21-regions': () =>
    importFixture('./fixtures/out/r21-regions.compiled.ts'),
  'r21-forward': () =>
    importFixture('./fixtures/out/r21-forward.compiled.ts'),
};

describe('R21 - component children slots', () => {
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
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('mounts and updates positional children without an event wrapper', async () => {
    const { App } = await IMPORTS['r21-positional']!();
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('0');
    button.click();
    expect(button.textContent).toBe('1');
  });

  it('mounts multiple children through an untyped object prop', async () => {
    const { App } = await IMPORTS['r21-object']!();
    document.body.appendChild(App('App', null));
    const strong = document.querySelector('strong')!;
    expect(strong.textContent).toBe('2');
    document.querySelector('button')!.click();
    expect(strong.textContent).toBe('4');
  });

  it('does not create content when the callee omits its slot', async () => {
    const mod = await IMPORTS['r21-lazy']!();
    document.body.appendChild(mod.App('App', null));
    expect(mod.created).toBe(0);
    expect(has('App/Worker')).toBe(false);
  });

  it('keeps nested component state and cleanup entity-owned', async () => {
    const mod = await IMPORTS['r21-entity']!();
    document.body.appendChild(mod.App('App', null));
    const button = document.querySelector('button')!;
    button.click();
    expect(button.textContent).toBe('1:1');
    expect(has('App/Worker')).toBe(true);
    unregister('App');
    expect(mod.disposed).toBe(1);
  });

  it('mounts and updates list and conditional regions in source order', async () => {
    const { App } = await IMPORTS['r21-regions']!();
    document.body.appendChild(App('App', null));
    expect([...document.querySelectorAll('span')].map((el) => el.textContent))
      .toEqual(['1', '2']);
    expect(document.querySelector('em')!.textContent).toBe('shown');

    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect([...document.querySelectorAll('span')].map((el) => el.textContent))
      .toEqual(['1']);
    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelector('i')!.textContent).toBe('hidden');
  });

  it('forwards an existing children slot through another component', async () => {
    const { App } = await IMPORTS['r21-forward']!();
    document.body.appendChild(App('App', null));
    const button = document.querySelector('button')!;
    button.click();
    expect(button.textContent).toBe('1');
  });
});

describe('R21 - children diagnostics', () => {
  it('requires a direct sole host insertion point', () => {
    expect(() =>
      compile(`
        function Frame(props) {
          return <section>before {props.children}</section>;
        }
        function App() { return <Frame><b>child</b></Frame>; }
      `),
    ).toThrowError(/must be the sole child/);
  });

  it('rejects competing explicit and nested children', () => {
    expect(() =>
      compile(`
        function Frame(children) { return <section>{children}</section>; }
        function App() {
          return <Frame children={() => {}}><b>child</b></Frame>;
        }
      `),
    ).toThrowError(/cannot use both a children prop and nested JSX children/);
  });

  it('rejects mounting or forwarding the same slot twice', () => {
    expect(() =>
      compile(`
        function Frame(props) {
          return <main><div>{props.children}</div><aside>{props.children}</aside></main>;
        }
        function App() { return <Frame><b>child</b></Frame>; }
      `),
    ).toThrowError(/can only be rendered or forwarded once/);
  });
});

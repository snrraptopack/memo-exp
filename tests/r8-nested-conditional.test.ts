/**
 * R8 - nested conditional-region ownership.
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
  function Child({ value }) {
    let clicks = 0;
    return <button id="child" onClick={() => clicks++}>{value}:{clicks}</button>;
  }

  export function App() {
    let outer = true;
    let inner = true;
    let value = 0;
    let items = [
      { id: 1, label: 'one', visible: true },
      { id: 2, label: 'two', visible: false },
    ];
    return <main>
      <button id="outer" onClick={() => outer = !outer}>outer</button>
      <button id="inner" onClick={() => inner = !inner}>inner</button>
      <button id="value" onClick={() => value++}>value</button>
      <button id="row" onClick={() => {
        items = [
          { ...items[0], visible: !items[0].visible },
          items[1],
        ];
      }}>row</button>

      {outer ? <section id="outer-on">
        {inner
          ? <Child value={value} />
          : <p id="inner-off">off:{value}</p>}
      </section> : <aside id="outer-off">outer off</aside>}

      <ul>{items.map((item, index) =>
        <li key={item.id} class="row">
          {item.visible
            ? <span class="row-visible">{index}:{item.label}</span>
            : <em class="row-hidden">{index}:hidden</em>}
        </li>
      )}</ul>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r8-nested-conditional.compiled.ts';
  return import(specifier);
}

describe('R8 - nested conditionals', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r8-nested-conditional.compiled.ts'),
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

  it('emits nested region and component ids under their structural owner', () => {
    const code = compile(SOURCE);
    expect(code).toMatch(
      /_id\d* \+ "\/when0" \+ "\/when1" \+ "\/Child"/,
    );
    expect(code).toMatch(/_rowId\d* \+ "\/when0"/);
  });

  it('updates and disposes nested branch and inline-row regions', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#child')?.textContent).toBe('0:0');
    expect(document.querySelectorAll('.row-visible')).toHaveLength(1);
    expect(document.querySelectorAll('.row-hidden')).toHaveLength(1);
    expect(_internals().registry.has('App/when0/when1')).toBe(true);
    expect(_internals().registry.has('App/when0/when1/Child')).toBe(true);
    expect(_internals().registry.has('App/items/Row[1]/when0')).toBe(
      true,
    );

    document.querySelector<HTMLButtonElement>('#value')!.click();
    expect(document.querySelector('#child')?.textContent).toBe('1:0');
    document.querySelector<HTMLButtonElement>('#child')!.click();
    expect(document.querySelector('#child')?.textContent).toBe('1:1');

    document.querySelector<HTMLButtonElement>('#inner')!.click();
    expect(document.querySelector('#child')).toBeNull();
    expect(document.querySelector('#inner-off')?.textContent).toBe('off:1');

    document.querySelector<HTMLButtonElement>('#row')!.click();
    expect(document.querySelectorAll('.row-visible')).toHaveLength(0);
    expect(document.querySelectorAll('.row-hidden')).toHaveLength(2);

    document.querySelector<HTMLButtonElement>('#outer')!.click();
    expect(document.querySelector('#inner-off')).toBeNull();
    expect(document.querySelector('#outer-off')).not.toBeNull();
    expect(
      [..._internals().registry.keys()].some((id) =>
        id.startsWith('App/when0/when1'),
      ),
    ).toBe(false);
  });
});

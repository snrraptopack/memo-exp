import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const source = `
  function track(id, value) {
    globalThis.__memoizedDomListSyncs.push(id);
    return value;
  }

  function Row({ item, isSelected }) {
    return <li data-id={item.id} class={track(item.id, isSelected) ? 'selected' : ''}>
      {item.label}
    </li>;
  }

  function Controls({ dispatch }) {
    return <div>
      <button id="select-one" onClick={() => dispatch({ type: 'SELECT', id: 1 })}>one</button>
      <button id="select-two" onClick={() => dispatch({ type: 'SELECT', id: 2 })}>two</button>
    </div>;
  }

  export function App() {
    let items = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
      { id: 3, label: 'three' },
    ];
    let selected = 0;
    const dispatch = action => {
      switch (action.type) {
        case 'SELECT':
          selected = action.id;
          break;
        case 'REPLACE':
          items = [{ id: 4, label: 'four' }];
          break;
      }
    };
    return <main>
      <Controls dispatch={dispatch} />
      <ul>{items.map(item =>
        <Row
          key={item.id}
          item={item}
          isSelected={selected === item.id}
        />
      )}</ul>
    </main>;
  }
`;

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'targeted-list-refresh.compiled.ts'),
    compile(source, { runtimePath: '@memoized-dom/runtime' }),
  );
});

describe('targeted keyed-list refresh execution', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((fn) => fn());
    document.body.innerHTML = '';
    (globalThis as any).__memoizedDomListSyncs = [];
  });

  afterEach(() => {
    resetScheduler();
    delete (globalThis as any).__memoizedDomListSyncs;
  });

  it('syncs only the previous and current selected keys', async () => {
    const specifier = './fixtures/out/targeted-list-refresh.compiled.ts';
    const { App } = await import(specifier);
    document.body.appendChild(App('App', null));
    const syncs = (globalThis as any).__memoizedDomListSyncs as number[];
    syncs.length = 0;

    (document.querySelector('#select-two') as HTMLButtonElement).click();
    expect(syncs).toEqual([2]);
    expect(document.querySelector('[data-id="2"]')?.className).toBe('selected');

    syncs.length = 0;
    (document.querySelector('#select-one') as HTMLButtonElement).click();
    expect(syncs).toEqual([2, 1]);
    expect(document.querySelector('[data-id="2"]')?.className).toBe('');
    expect(document.querySelector('[data-id="1"]')?.className).toBe('selected');
  });
});

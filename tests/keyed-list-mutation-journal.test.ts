import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
let scheduled: Array<() => void> = [];
const flush = () => {
  while (scheduled.length > 0) scheduled.shift()!();
};
const source = `
  function track(id, value) {
    globalThis.__memoizedDomMutationSyncs.push(id);
    return value;
  }

  function makeItems() {
    return Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      label: 'row ' + (index + 1),
    }));
  }

  function Row({ item }) {
    return <li data-id={item.id}>{track(item.id, item.label)}</li>;
  }

  function Controls({ dispatch }) {
    return <div>
      <button id="update" onClick={() => dispatch({ type: 'UPDATE' })}>update</button>
      <button id="swap" onClick={() => dispatch({ type: 'SWAP' })}>swap</button>
      <button id="remove" onClick={() => dispatch({ type: 'REMOVE', id: 2 })}>remove</button>
    </div>;
  }

  export function App() {
    let items = makeItems();
    const dispatch = action => {
      switch (action.type) {
        case 'UPDATE':
          for (let index = 0; index < items.length; index += 10) {
            items[index]!.label += '!';
          }
          break;
        case 'SWAP': {
          const value = items[1];
          items[1] = items[10];
          items[10] = value;
          break;
        }
        case 'REMOVE': {
          const index = items.findIndex(item => item.id === action.id);
          if (index >= 0) items.splice(index, 1);
          break;
        }
      }
    };
    return <main>
      <Controls dispatch={dispatch} />
      <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>
    </main>;
  }
`;

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'keyed-list-mutation-journal.compiled.ts'),
    compile(source, { runtimePath: '@memoized-dom/runtime' }),
  );
});

describe('keyed list mutation journal', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    scheduled = [];
    setScheduler((fn) => scheduled.push(fn));
    document.body.innerHTML = '';
    (globalThis as any).__memoizedDomMutationSyncs = [];
  });

  afterEach(() => {
    resetScheduler();
    delete (globalThis as any).__memoizedDomMutationSyncs;
  });

  it('refreshes only directly mutated keys and keeps structural edits full', async () => {
    const specifier = './fixtures/out/keyed-list-mutation-journal.compiled.ts';
    const { App } = await import(specifier);
    document.body.appendChild(App('App', null));
    const syncs = (globalThis as any).__memoizedDomMutationSyncs as number[];
    syncs.length = 0;

    (document.querySelector('#update') as HTMLButtonElement).click();
    flush();
    expect(syncs).toEqual([1, 11]);
    expect(document.querySelector('[data-id="1"]')?.textContent).toBe('row 1!');
    expect(document.querySelector('[data-id="11"]')?.textContent).toBe('row 11!');

    syncs.length = 0;
    (document.querySelector('#swap') as HTMLButtonElement).click();
    flush();
    expect(syncs).toHaveLength(12);
    expect(document.querySelectorAll('li')[1]?.getAttribute('data-id')).toBe('11');

    syncs.length = 0;
    (document.querySelector('#remove') as HTMLButtonElement).click();
    flush();
    expect(syncs).toHaveLength(11);
    expect(document.querySelector('[data-id="2"]')).toBeNull();
  });
});

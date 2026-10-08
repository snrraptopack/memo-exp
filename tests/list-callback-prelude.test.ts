import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, expect, it, vi } from 'bun:test';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/list-callback-prelude');
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component', 'conditional']) {
    const jsx = kind === 'inline' ? '<li key={row.id}>{label}</li>' : '<Row key={row.id} label={label} />';
    writeFileSync(join(directory, `${kind}.ts`), compile(`
      let flag = 0;
      let show = true;
      const rows = [{ id: 1, text: 'one' }, { id: 2, text: 'two' }];
      function inspectRow(row, index) { globalThis.__record(row.id, flag, row.text + ':' + index); }
      function Row({ label }) { return <li>{label}</li>; }
      export function App() {
        return <main><button onClick={() => { flag++; }}>change</button>
          <ul>{${kind === 'conditional' ? 'show && ' : ''}rows.map((row, index) => {
            const label = row.text + ':' + index;
            inspectRow(row, index);
            return ${jsx};
          })}</ul>
        </main>;
      }
    `));
  }
});
afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  unstubAllGlobals();
});

it.each(['inline', 'component', 'conditional'])('replays %s callback expressions once per row and routes their reads', async kind => {
  const record = vi.fn();
  stubGlobal('__record', record);
  const specifier = `./fixtures/out/list-callback-prelude/${kind}.ts`;
  const { App } = await import(specifier);
  setScheduler(run => run());
  document.body.append(App('App', null));
  const rows = [...document.querySelectorAll('li')];
  expect(record.mock.calls).toEqual([[1, 0, 'one:0'], [2, 0, 'two:1']]);
  record.mockClear();
  document.querySelector('button')!.click();
  expect(record.mock.calls).toEqual([[1, 1, 'one:0'], [2, 1, 'two:1']]);
  expect([...document.querySelectorAll('li')]).toEqual(rows);
  expect(rows.map(row => row.textContent)).toEqual(['one:0', 'two:1']);
});

it('keeps a full list refresh when callback expressions read the selected value', () => {
  const output = compile(`
    function Row({ item, selected }) { return <li>{selected ? 'yes' : 'no'}</li>; }
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      let selected = 1;
      return <main><button onClick={() => { selected = 2; }}>select</button>
        <ul>{rows.map(item => {
          globalThis.record(selected, item.id);
          return <Row key={item.id} item={item} selected={selected === item.id} />;
        })}</ul>
      </main>;
    }
  `);
  expect(output).not.toContain('.refreshKey(');
});

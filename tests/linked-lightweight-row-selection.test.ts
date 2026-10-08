import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModules } from '../packages/compiler/src/linker';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out', 'linked-selection');

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  const modules = compileModules({
    './app.tsx': `
      import { makeRows } from './data';
      let rows = makeRows(1000);
      let selected = null;
      function Row({ item }) {
        return <li class={selected === item.id ? 'danger' : ''}
          onClick={() => { selected = item.id; }}>{item.id}</li>;
      }
      export function App() {
        return <main>
          <button id="large" onClick={() => { rows = makeRows(10000); selected = null; }}>large</button>
          <ul>{rows.map(item => <Row key={item.id} item={item} />)}</ul>
        </main>;
      }
    `,
    './data.ts': `
      export function makeRows(count) {
        return Array.from({ length: count }, (_, id) => ({ id }));
      }
    `,
  });
  for (const [file, code] of Object.entries(modules)) {
    writeFileSync(join(outDir, file.slice(2)), code);
  }
});

afterEach(() => {
  // This suite targets routing, not bulk removal. Happy DOM's range deletion
  // is prohibitively slow at 10k rows; Chromium covers the native range path.
  const range = document.createRange;
  document.createRange = undefined as unknown as typeof range;
  try { _internals().registry.forEach((_, id) => unregister(id)); }
  finally { document.createRange = range; }
  resetAccessTable();
  resetScheduler();
  document.body.replaceChildren();
});

describe('linked lightweight component rows', () => {
  it('updates the selected row through the access table', async () => {
    setScheduler(run => run());
    const specifier = './fixtures/out/linked-selection/app.tsx';
    const { App } = await import(specifier);
    document.body.appendChild(App('App', null));
    const rows = document.querySelectorAll('li');
    expect(rows).toHaveLength(1000);
    rows[500]!.click();
    expect(rows[500]!.className).toBe('danger');
    rows[501]!.click();
    expect(rows[500]!.className).toBe('');
    expect(rows[501]!.className).toBe('danger');

    document.getElementById('large')!.click();
    const largeRows = document.querySelectorAll('li');
    expect(largeRows).toHaveLength(10000);
    largeRows[500]!.click();
    expect(largeRows[500]!.className).toBe('danger');
  });
});

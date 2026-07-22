/**
 * @file compiled-app.ts
 * Benchmark app compiled dynamically from REAL TSX source via compile().
 * Tests component <Row> with the new single-pass reconcile engine.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler/compile';
import type { RowData } from './data';

const TSX_SOURCE = `
import { buildData, type RowData } from '../data';

let data: RowData[] = [];
let selected: number | null = null;

function Row(item: RowData) {
  return (
    <li
      class={selected === item.id ? 'danger' : ''}
      onClick={() => {
        selected = item.id;
      }}
    >
      {item.id}: {item.label}
    </li>
  );
}

export function BenchApp() {
  return (
    <div>
      <div class="toolbar">
        <button onClick={() => { data = buildData(1000); selected = null; }}>create1k</button>
        <button onClick={() => { data = buildData(10000); selected = null; }}>create10k</button>
        <button onClick={() => { data = data.concat(buildData(1000)); }}>append1k</button>
        <button onClick={() => {
          for (let i = 0; i < data.length; i += 10) data[i].label += ' !!!';
        }}>update</button>
        <button onClick={() => {
          if (data.length > 998) {
            const t = data[1];
            data[1] = data[998];
            data[998] = t;
          }
        }}>swap</button>
        <button onClick={() => { data.splice(500, 1); }}>remove</button>
        <button onClick={() => { data = []; selected = null; }}>clear</button>
      </div>
      <ul>
        {data.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
`;

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, 'dist');

export async function createCompiledTsxApp() {
  mkdirSync(distDir, { recursive: true });
  const compiledJs = compile(TSX_SOURCE, { runtimePath: '../../src/runtime' });
  const compiledPath = join(distDir, 'compiled-app.compiled.ts');
  writeFileSync(compiledPath, compiledJs, 'utf-8');

  // Dynamic import of the compiled module
  const mod = await import(`./dist/compiled-app.compiled.ts?t=${Date.now()}`);
  
  const root = mod.BenchApp('App', null);

  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(`Button '${name}' not found in compiled app`);
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}

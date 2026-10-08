import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');

async function mountSource(name: string, source: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${name}.compiled.ts`);
  writeFileSync(
    path,
    compile(source, { runtimePath: '@memoized-dom/runtime' }),
  );
  const { App } = await import(/* @vite-ignore */ pathToFileURL(path).href);
  document.body.appendChild(App('App', null));
}

describe('reported alias mutations', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((run) => run());
  });

  afterEach(() => resetScheduler());

  it.each([
    ['component alias', `
      const items = [1];
      function Other() { return <p>{items.length}</p>; }
      export function App() {
        const alias = items;
        return <div><button onClick={() => alias.push(2)}>go</button><Other /></div>;
      }
    `],
    ['conditional alias', `
      const items = [1]; const other = [9]; const flag = true;
      function Other() { return <p>{items.length}</p>; }
      export function App() {
        const target = flag ? items : other;
        return <div><button onClick={() => target.push(2)}>go</button><Other /></div>;
      }
    `],
    ['module alias', `
      const items = [1]; const alias = items;
      function Other() { return <p>{items.length}</p>; }
      export function App() {
        return <div><button onClick={() => alias.push(2)}>go</button><Other /></div>;
      }
    `],
    ['module holder', `
      const items = [1]; const holder = { list: items };
      function Other() { return <p>{items.length}</p>; }
      export function App() {
        return <div><button onClick={() => holder.list.push(2)}>go</button><Other /></div>;
      }
    `],
    ['call result', `
      const items = [1]; function getItems() { return items; }
      function Other() { return <p>{items.length}</p>; }
      export function App() {
        return <div><button onClick={() => getItems().push(2)}>go</button><Other /></div>;
      }
    `],
    ['for-of item', `
      const rows = [{ n: 1 }];
      function Other() { return <p>{rows[0].n}</p>; }
      export function App() {
        return <div><button onClick={() => { for (const row of rows) row.n++; }}>go</button><Other /></div>;
      }
    `],
    ['destructured object', `
      const cfg = { nested: { x: 1 } };
      function Other() { return <p>{cfg.nested.x}</p>; }
      export function App() {
        const { nested } = cfg;
        return <div><button onClick={() => { nested.x = 2; }}>go</button><Other /></div>;
      }
    `],
    ['indexed object', `
      const rows = [{ id: 1, n: 1 }];
      function Other() { return <p>{rows[0].n}</p>; }
      export function App() {
        const first = rows[0];
        return <div><button onClick={() => { first.n = 2; }}>go</button><Other /></div>;
      }
    `],
    ['found object', `
      const rows = [{ id: 1, n: 1 }];
      function Other() { return <p>{rows[0].n}</p>; }
      export function App() {
        const row = rows.find(item => item.id === 1)!;
        return <div><button onClick={() => { row.n = 2; }}>go</button><Other /></div>;
      }
    `],
    ['closure store', `
      function makeCounter() {
        let count = 1;
        return { inc() { count++; }, get() { return count; } };
      }
      const counter = makeCounter();
      function Other() { return <p>{counter.get()}</p>; }
      export function App() {
        return <div><button onClick={() => counter.inc()}>go</button><Other /></div>;
      }
    `],
  ])('%s updates another reader', async (name, source) => {
    await mountSource(`alias-report-${name.replaceAll(' ', '-')}`, source);
    expect(document.querySelector('p')?.textContent).toBe('1');
    document.querySelector('button')!.click();
    expect(document.querySelector('p')?.textContent).toBe('2');
  });

  it('updates instance state mutated through a local call result', async () => {
    await mountSource('alias-report-local-call-result', `
      export function App() {
        let items = [1];
        function getItems() { return items; }
        return <div>
          <button onClick={() => getItems().push(2)}>go</button>
          <p>{items.length}</p>
        </div>;
      }
    `);
    expect(document.querySelector('p')?.textContent).toBe('1');
    document.querySelector('button')!.click();
    expect(document.querySelector('p')?.textContent).toBe('2');
  });

  it.each([
    ['holder returned by a call', 'const items=[1]; function box(){ return { list: items }; }', '', 'box().list.push(2)', 'items.length', '2'],
    ['getter returning state', 'const items=[1]; const store = { get list(){ return items; } };', '', 'store.list.push(2)', 'items.length', '2'],
    ['class field holding state', 'const items=[1]; class S { list = items; add(){ this.list.push(2); } } const s = new S();', '', 's.add()', 'items.length', '2'],
    ['array destructuring', 'const rows=[{n:1}];', 'const [first] = rows;', 'first.n++', 'rows[0].n', '2'],
    ['Array.from elements', 'const rows=[{n:1}];', 'const s = Array.from(rows);', 's[0].n++', 'rows[0].n', '2'],
    ['Object.values element', 'const cfg={a:{n:1}};', 'const [v] = Object.values(cfg);', 'v.n++', 'cfg.a.n', '2'],
    ['object rest copy', 'const cfg={a:1,x:0};', 'const {a, ...rest} = cfg;', 'rest.x = 1', 'cfg.x', '0'],
  ])('%s keeps both readers correct', async (name, declarations, prelude, write, read, expected) => {
    await mountSource(`alias-neighbor-${name.replaceAll(' ', '-')}`, `
      ${declarations}
      function Other() { return <p id="other">{${read}}</p>; }
      export function App() {
        ${prelude}
        return <div>
          <button onClick={() => { ${write}; }}>go</button>
          <span id="inline">{${read}}</span>
          <Other />
        </div>;
      }
    `);
    document.querySelector('button')!.click();
    expect(document.getElementById('inline')?.textContent).toBe(expected);
    expect(document.getElementById('other')?.textContent).toBe(expected);
  });
});

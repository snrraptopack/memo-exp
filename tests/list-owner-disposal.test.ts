import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { registeredIds, resetScheduler, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/list-owner-disposal');
const globals = globalThis as typeof globalThis & { mountOwnedRow?: (node: Node) => () => void };
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'refs.ts'), compile(`
    function Row(item) { return <li ref={node => globalThis.mountOwnedRow(node)}>{item.id}</li>; }
    export function App() {
      let items = [{id: 1}, {id: 2}];
      return <main><ul>{items.map(item => <Row key={item.id} item={item}/>)}</ul>
        <ol>{items.map(item => <li key={item.id} ref={node => globalThis.mountOwnedRow(node)}>{item.id}</li>)}</ol>
      </main>;
    }`));
  writeFileSync(join(directory, 'inline.ts'), compile(`
    export function App() { let items = [{id: 1}, {id: 2}];
      return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>; }
  `));
});
afterEach(() => {
  for (const id of registeredIds()) {
    try { unregisterSubtree(id); } catch {}
  }
  delete globals.mountOwnedRow; document.body.replaceChildren(); resetScheduler();
});

it('disposes lightweight row refs and every owned list even when a cleanup throws', async () => {
  const mounted: Node[] = []; const cleaned: Node[] = []; const error = new Error('ref cleanup');
  globals.mountOwnedRow = node => {
    mounted.push(node);
    return () => { cleaned.push(node); if (node === mounted[0]) throw error; };
  };
  setScheduler(fn => fn());
  const specifier = './fixtures/out/list-owner-disposal/refs.ts';
  const { App } = await import(specifier);
  const root = App('App', null); document.body.append(root);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mounted).toHaveLength(4);
  // Component Row is lightweight; the ref-bearing inline rows are entities.
  expect(registeredIds().filter(id => id.includes('/Row['))).toHaveLength(2);
  expect(() => unregisterSubtree('App')).toThrow(error);
  expect(new Set(cleaned)).toEqual(new Set(mounted)); expect(cleaned).toHaveLength(4);
  expect(root.querySelectorAll('li')).toHaveLength(0); expect(registeredIds()).toEqual([]);
  unregisterSubtree('App'); expect(cleaned).toHaveLength(4);
});

it('disposes a DOM-only inline list through its owner', async () => {
  const specifier = './fixtures/out/list-owner-disposal/inline.ts';
  const { App } = await import(specifier);
  const root = App('App', null); document.body.append(root);
  expect(root.querySelectorAll('li')).toHaveLength(2);
  unregisterSubtree('App');
  expect(root.childNodes).toHaveLength(0); expect(registeredIds()).toEqual([]);
});

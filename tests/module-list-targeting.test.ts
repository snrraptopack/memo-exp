import { afterEach, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import { createListRegion } from '@memoized-dom/runtime';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');
const probe: typeof globalThis & { __moduleListSyncs?: number[] } = globalThis;
const source = `
  let items = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
  let suffix = '!';
  function track(id, label) {
    globalThis.__moduleListSyncs.push(id);
    return label;
  }
  function Row({ item }) {
    return <li data-id={item.id}>{track(item.id, item.label)}{suffix}</li>;
  }
  export function App() {
    return <main>
      <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>
      <ol>{items.map(item => <li data-id={item.id}>{track(item.id, item.label)}{suffix}</li>)}</ol>
      <button id="first" onClick={() => { items[0].label = 'A'; }}>first</button>
      <button id="second" onClick={() => { items[1].label = 'B'; }}>second</button>
      <button id="suffix" onClick={() => { suffix = '?'; }}>suffix</button>
    </main>;
  }
`;

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'module-list-targeting.compiled.ts'),
    compile(source, { runtimePath: '@memoized-dom/runtime' }));
  writeFileSync(join(outDir, 'module-list-key-fallback.compiled.ts'),
    compile(source.replace('let suffix', 'function rowKey(id) { return id; }\n  let suffix')
      .replace('key={item.id}', 'key={rowKey(item.id)}'),
      { runtimePath: '@memoized-dom/runtime' }));
  writeFileSync(join(outDir, 'module-list-append.compiled.ts'),
    compile(source.replace("items[0].label = 'A';", "items.push({ id: 3, label: 'c' });")
      .replace("items[1].label = 'B';", "items.push({ id: 4, label: 'd' });"),
      { runtimePath: '@memoized-dom/runtime' }));
  writeFileSync(join(outDir, 'module-list-append-content.compiled.ts'),
    compile(source.replace("items[1].label = 'B';", "items.push({ id: 3, label: 'c' });"),
      { runtimePath: '@memoized-dom/runtime' }));
});

afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler();
  document.body.innerHTML = '';
  delete probe.__moduleListSyncs;
});

it('refreshes matching inline and component rows, merges targets, and preserves broad updates', async () => {
  const scheduled: Array<() => void> = [];
  setScheduler(callback => scheduled.push(callback));
  const syncs: number[] = [];
  probe.__moduleListSyncs = syncs;
  // The fixture is generated in beforeAll; it cannot be statically imported.
  const specifier = './fixtures/out/module-list-targeting.compiled.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  const text = () => [...document.querySelectorAll('li')].map(node => node.textContent);
  expect(text()).toEqual(['A!', 'b!', 'A!', 'b!']);
  expect(syncs).toEqual([1, 1]);

  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  (document.querySelector('#second') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect(text()).toEqual(['A!', 'B!', 'A!', 'B!']);
  expect(syncs.sort()).toEqual([1, 1, 2, 2]);

  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  (document.querySelector('#suffix') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect(text()).toEqual(['A?', 'B?', 'A?', 'B?']);
  expect(syncs.sort()).toEqual([1, 1, 2, 2]);
});

it('keeps general replay when a list key needs a helper computation', async () => {
  const scheduled: Array<() => void> = [];
  setScheduler(callback => scheduled.push(callback));
  const syncs: number[] = [];
  probe.__moduleListSyncs = syncs;
  // The compiled fixture is created at test runtime in beforeAll.
  const specifier = './fixtures/out/module-list-key-fallback.compiled.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect([...document.querySelectorAll('li')].map(node => node.textContent)).toEqual(['A!', 'b!', 'A!', 'b!']);
  expect(syncs.sort()).toEqual([1, 1, 2, 2]);
});

it('reads only targeted positions when fixed positions are proven, and validates unproven reorders', () => {
  const records = Array.from({ length: 64 }, (_, id) => ({ id, label: String(id) }));
  let reads = 0;
  // Observe collection access without changing its identities or positions.
  const items = new Proxy(records, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const host = document.createElement('ul');
  const region = createListRegion(host, 'scan-proof', item => {
    const node = document.createElement('li');
    node.textContent = item.label;
    return { nodes: node, entities: [], update: () => { node.textContent = item.label; } };
  }, item => item.id, false);
  region.reconcile(items);
  records[7]!.label = 'changed';
  reads = 0;
  region.refreshIndices(items, [7], true);
  expect(host.querySelectorAll('li')[7]!.textContent).toBe('changed');
  expect(reads).toBe(1);
  const first = records[0]!;
  records[0] = records[1]!;
  records[1] = first;
  region.refreshIndices(items, [0]);
  expect([...host.querySelectorAll('li')].slice(0, 2).map(node => node.textContent)).toEqual(['1', '0']);
  region.dispose();
});

it('appends only new rows in shared readers and replays retained rows for broad updates', async () => {
  const scheduled: Array<() => void> = [];
  setScheduler(callback => scheduled.push(callback));
  const syncs: number[] = [];
  probe.__moduleListSyncs = syncs;
  // beforeAll generates the module; static import would run before generation.
  const specifier = './fixtures/out/module-list-append.compiled.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const retained = [...document.querySelectorAll('li')];
  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  (document.querySelector('#second') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect([...document.querySelectorAll('li')].map(node => node.textContent)).toEqual([
    'a!', 'b!', 'c!', 'd!', 'a!', 'b!', 'c!', 'd!',
  ]);
  expect(syncs.sort()).toEqual([3, 3, 4, 4]);
  expect(document.querySelector('ul li')).toBe(retained[0]);
  syncs.length = 0;
  (document.querySelector('#suffix') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect([...document.querySelectorAll('li')].map(node => node.textContent)).toEqual([
    'a?', 'b?', 'c?', 'd?', 'a?', 'b?', 'c?', 'd?',
  ]);
  expect(syncs.sort()).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
});

it('does not read retained positions during proven append and rejects duplicate keys before mounting', () => {
  const records = Array.from({ length: 64 }, (_, id) => ({ id, label: String(id) }));
  const reads: number[] = [];
  const items = new Proxy(records, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key));
      return Reflect.get(target, key, receiver);
    },
  });
  const host = document.createElement('ul');
  const region = createListRegion(host, 'append-proof', item => {
    const node = document.createElement('li');
    node.textContent = item.label;
    return { nodes: node, entities: [], update: () => { node.textContent = item.label; } };
  }, item => item.id, false);
  region.reconcile(items);
  const first = host.querySelector('li');
  records.push({ id: 64, label: 'new' });
  reads.length = 0;
  region.reconcile(items, true, true);
  expect(reads.filter(index => index < 64)).toEqual([]);
  expect(reads.length).toBeLessThanOrEqual(3);
  expect(host.querySelector('li')).toBe(first);
  expect(host.querySelector('li:last-of-type')!.textContent).toBe('new');
  records.push({ id: 65, label: 'valid' }, { id: 64, label: 'duplicate' });
  expect(() => region.reconcile(items, true, true)).toThrow(/duplicate list key/);
  expect(host.querySelectorAll('li')).toHaveLength(65);
  records.splice(65);
  records[0]!.label = 'broad';
  records.push({ id: 65, label: 'next' });
  region.reconcile(items, false, true);
  expect(first!.textContent).toBe('broad');
  expect(host.querySelector('li:last-of-type')!.textContent).toBe('next');
  region.dispose();
});

it('targets existing content after append and reconciles mixed append/content batches', async () => {
  const scheduled: Array<() => void> = [];
  setScheduler(callback => scheduled.push(callback));
  const syncs: number[] = [];
  probe.__moduleListSyncs = syncs;
  // beforeAll creates this compiled module, so static import is not possible.
  const specifier = './fixtures/out/module-list-append-content.compiled.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  (document.querySelector('#second') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect([...document.querySelectorAll('li')].map(node => node.textContent)).toEqual([
    'A!', 'b!', 'c!', 'A!', 'b!', 'c!',
  ]);
  expect(syncs.sort()).toEqual([1, 1, 2, 2, 3, 3]);
  const retained = document.querySelector('ul li');
  syncs.length = 0;
  (document.querySelector('#first') as HTMLButtonElement).click();
  while (scheduled.length) scheduled.shift()!();
  expect(document.querySelector('ul li')).toBe(retained);
  expect([...document.querySelectorAll('li')].map(node => node.textContent)).toEqual([
    'A!', 'b!', 'c!', 'A!', 'b!', 'c!',
  ]);
  expect(syncs.sort()).toEqual([1, 1]);
});

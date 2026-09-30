import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'list-text-cache.compiled.ts'), compile(`
    export function App({ items }) {
      return <ul>{items.map(item => <li key={item.id}>{item.value}</li>)}</ul>;
    }
  `, { runtimePath: '@memoized-dom/runtime' }));
});

beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(fn => fn());
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  resetScheduler();
});

async function mount(value: unknown) {
  const specifier = './fixtures/out/list-text-cache.compiled.ts';
  const { App } = await import(specifier);
  const items = [{ id: 1, value }];
  document.body.appendChild(App('App', null, [{ items }]));
  const text = document.querySelector('li')!.firstChild as Text;
  return { items, text, render: () => _internals().registry.get('App')!.render() };
}

it('replays mutable string conversion while avoiding unchanged DOM reads and writes', async () => {
  let label = 'first';
  let conversions = 0;
  const app = await mount({ toString() { conversions++; return label; } });
  expect(app.text.data).toBe('first');
  const getter = vi.spyOn(app.text, 'data', 'get');
  const observer = new MutationObserver(() => {});
  observer.observe(app.text, { characterData: true });

  app.render();
  expect(conversions).toBe(2);
  expect(getter).not.toHaveBeenCalled();
  expect(observer.takeRecords()).toHaveLength(0);

  label = 'second';
  app.render();
  expect(conversions).toBe(3);
  getter.mockRestore();
  expect(app.text.data).toBe('second');
  expect(observer.takeRecords()).toHaveLength(1);
  observer.disconnect();
});

it('compares rendered strings and preserves empty-text normalization', async () => {
  const app = await mount(1);
  const observer = new MutationObserver(() => {});
  observer.observe(app.text, { characterData: true });
  app.items[0]!.value = '1';
  app.render();
  expect(observer.takeRecords()).toHaveLength(0);
  for (const value of [null, undefined, false, true]) {
    app.items[0]!.value = value;
    app.render();
    expect(app.text.data).toBe('');
  }
  observer.disconnect();
});

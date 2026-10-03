import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'list-text-cache-probe.ts'), `
    import * as runtime from '@memoized-dom/runtime/testing';
    export * from '@memoized-dom/runtime/testing';
    export function textValue(value) { globalThis.__textNormalizations++; return runtime.textValue(value); }
  `);
  for (const kind of ['inline', 'component']) writeFileSync(join(outDir, `list-text-cache-${kind}.compiled.ts`), compile(`
    function Row({ item }) { return <li>{item.value}</li>; }
    export function App({ items }) {
      return <ul>{items.map(item => ${kind === 'inline' ? '<li key={item.id}>{item.value}</li>' : '<Row key={item.id} item={item} />'})}</ul>;
    }
  `, { runtimePath: './list-text-cache-probe' }));
});

beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(fn => fn());
  document.body.innerHTML = '';
  vi.stubGlobal('__textNormalizations', 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetScheduler();
  vi.unstubAllGlobals();
});

async function mount(value: unknown, kind = 'inline') {
  const specifier = `./fixtures/out/list-text-cache-${kind}.compiled.ts`;
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

const normalizations = () => (globalThis as unknown as { __textNormalizations: number }).__textNormalizations;
const resetNormalizations = () => { (globalThis as unknown as { __textNormalizations: number }).__textNormalizations = 0; };

for (const kind of ['inline', 'component']) {
  it.each(['label', 7, 7n, null, undefined, true, false, Symbol('text')])(`${kind}: skips unchanged primitive normalization for %s`, async value => {
    const app = await mount(value, kind);
    const initial = app.text.data;
    resetNormalizations();
    for (let i = 0; i < 3; i++) app.render();
    expect(normalizations()).toBe(0);
    expect(app.text.data).toBe(initial);
    app.items[0]!.value = 'changed'; app.render();
    expect(normalizations()).toBe(1); expect(app.text.data).toBe('changed');
  });

  it(`${kind}: reads unchanged primitive getters and preserves reentrant reads`, async () => {
    const app = await mount('first', kind);
    let reads = 0, reenter = false;
    Object.defineProperty(app.items[0], 'value', { configurable: true, get() {
      reads++;
      if (reenter) {
        reenter = false;
        Object.defineProperty(app.items[0], 'value', { configurable: true, writable: true, value: 'inner' });
        app.render();
      }
      return 'first';
    } });
    resetNormalizations(); app.render();
    expect(reads).toBe(1); expect(normalizations()).toBe(0);
    reenter = true; app.render();
    expect(reads).toBe(2); expect(app.text.data).toBe('first');
    app.render(); expect(app.text.data).toBe('inner');
  });

  it.each(['object', 'function'])(`${kind}: keeps repeated %s conversions observable`, async shape => {
    let label = 'first', conversions = 0;
    const value = shape === 'object' ? {} : function value() {};
    value.toString = () => { conversions++; return label; };
    const app = await mount(value, kind);
    app.render(); label = 'second'; app.render();
    expect(conversions).toBe(3); expect(app.text.data).toBe('second');
  });

  it.each([false, true])(`${kind}: invalidates after a reentrant opaque conversion (throws=%s)`, async throws => {
    const app = await mount('first', kind);
    const failure = new Error('conversion');
    app.items[0]!.value = { toString() {
      app.items[0]!.value = 'inner'; app.render();
      if (throws) throw failure;
      return 'outer';
    } };
    if (throws) expect(app.render).toThrow(failure);
    else { app.render(); expect(app.text.data).toBe('outer'); }
    app.render(); expect(app.text.data).toBe('inner');
    resetNormalizations(); app.render(); expect(normalizations()).toBe(0);
  });
}

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

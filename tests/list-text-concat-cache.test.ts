import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { mount, registerRootFactory, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { renderToString } from '@memoized-dom/server';

let mounted: MountedApplication | undefined;

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out');
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component']) {
    const row = kind === 'inline'
      ? "<li key={item.key} onClick={() => { item.right += '!'; }}>{item.left + ':' + item.right}</li>"
      : '<Row key={item.key} item={item} />';
    writeFileSync(join(directory, `text-concat-${kind}.compiled.ts`), compile(`
      function Row({ item }) {
        return <li onClick={() => { item.right += '!'; }}>{item.left + ':' + item.right}</li>;
      }
      export function App({ items }) {
        return <ul>{items.map(item => ${row})}</ul>;
      }
      export function HydratedApp() {
        let items = [{ key: 1, left: 1, right: 'one' }, { key: 2, left: 2, right: 'two' }];
        return <section>
          <button onClick={() => { items = [...items].reverse(); }}>reverse</button>
          <ul>{items.map(item => ${row})}</ul>
        </section>;
      }
    `));
  }
});

beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(run => run());
  document.body.replaceChildren();
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
  resetScheduler();
});

for (const kind of ['inline', 'component']) describe(`${kind} row text joins`, () => {
  async function create(item: { left: unknown; right: unknown }) {
    const specifier = `./fixtures/out/text-concat-${kind}.compiled.ts`;
    const { App } = await import(specifier);
    const items = [{ key: 1 } as { key: number; left: unknown; right: unknown }];
    // Preserve accessors supplied by the test.
    Object.defineProperties(items[0], Object.getOwnPropertyDescriptors(item));
    document.body.append(App('App', null, [{ items }]));
    const node = document.querySelector('li')!;
    return { item: items[0]!, node, render: () => _internals().registry.get('App')!.render() };
  }

  it('evaluates both getters in order on unchanged replays and skips DOM writes', async () => {
    const reads: string[] = [];
    let left: number | string = 1;
    let right = 'one';
    const app = await create({ get left() { reads.push('left'); return left; },
      get right() { reads.push('right'); return right; } });
    expect(reads).toEqual(['left', 'right']);
    reads.length = 0;
    const observer = new MutationObserver(() => {});
    observer.observe(app.node, { subtree: true, characterData: true });
    app.render();
    expect(reads).toEqual(['left', 'right']);
    expect(observer.takeRecords()).toHaveLength(0);
    left = '1';
    app.render();
    expect(observer.takeRecords()).toHaveLength(0);
    right = 'changed';
    app.render();
    expect(app.node.textContent).toBe('1:changed');
    expect(observer.takeRecords()).toHaveLength(1);
    expect(document.querySelector('li')).toBe(app.node);
    observer.disconnect();
  });

  it('retains opaque conversion order and invalidates after returning to primitives', async () => {
    const order: string[] = [];
    let left: unknown = 1;
    let right: unknown = 'one';
    let opaqueLabel = 'opaque';
    const app = await create({ get left() { order.push('left'); return left; },
      get right() { order.push('right'); return right; } });
    app.render();
    left = { valueOf() { order.push('left conversion'); return 2; } };
    right = { toString() { order.push('right conversion'); return opaqueLabel; } };
    for (let i = 0; i < 2; i++) {
      order.length = 0;
      app.render();
      expect(order).toEqual(['left', 'left conversion', 'right', 'right conversion']);
      expect(app.node.textContent).toBe('2:opaque');
    }
    opaqueLabel = 'changed';
    app.render();
    expect(app.node.textContent).toBe('2:changed');
    left = 1; right = 'one';
    app.render();
    expect(app.node.textContent).toBe('1:one');
  });

  it('preserves exceptions and recovers the previously cached primitive text', async () => {
    let rightReads = 0;
    let left: unknown = 1;
    let right: unknown = 'one';
    const app = await create({ get left() { return left; },
      get right() { rightReads++; return right; } });
    // Compare the emitted expression with authored JavaScript in this engine.
    // Bun's JavaScriptCore reads the right operand before a Symbol error;
    // V8 throws earlier. The compiler must preserve the host's behavior.
    function authoredRightReads() {
      let reads = 0;
      const item = { get left() { return left; }, get right() { reads++; return right; } };
      try { void (item.left + ':' + item.right); } catch {}
      return reads;
    }
    app.render();
    left = Symbol('left'); rightReads = 0;
    expect(app.render).toThrow(TypeError);
    expect(rightReads).toBe(authoredRightReads());
    left = 1; right = Symbol('right'); rightReads = 0;
    expect(app.render).toThrow(TypeError);
    expect(rightReads).toBe(authoredRightReads());
    left = { valueOf() { throw new Error('conversion'); } }; rightReads = 0;
    expect(app.render).toThrow('conversion');
    expect(rightReads).toBe(authoredRightReads());
    left = 1; right = 'one';
    app.render();
    expect(app.node.textContent).toBe('1:one');
  });

  it.each(['left', 'right'] as const)('invalidates a primitive cache seeded by reentrant %s conversion', async side => {
    const app = await create({ left: 1, right: 'one' });
    app.render();
    app.item[side] = { valueOf() {
      app.item[side] = side === 'left' ? 1 : 'one';
      app.render();
      return side === 'left' ? 2 : 'two';
    } };
    app.render();
    expect(app.node.textContent).toBe(side === 'left' ? '2:one' : '1:two');
    app.render();
    expect(app.node.textContent).toBe('1:one');
  });

  it.each(['primitive', 'opaque'] as const)('checks the cache after a right getter reenters with %s values', async mode => {
    let left = 1, right: unknown = 'one', reenter = false;
    let app: Awaited<ReturnType<typeof create>>;
    app = await create({ get left() { return left; }, get right() {
      if (reenter) {
        reenter = false;
        const outerRight = right;
        left = 2;
        right = mode === 'primitive' ? 'two' : { toString() { return 'two'; } };
        app.render();
        return outerRight;
      }
      return right;
    } });
    const node = app.node;
    reenter = true;
    app.render();
    // The outer expression captured 1 and returns "one" after the nested
    // update. Its completed text supersedes the nested "2:two" result.
    expect(node.textContent).toBe('1:one');
    app.render();
    expect(node.textContent).toBe('2:two');
    expect(document.querySelector('li')).toBe(node);
  });

  it('adopts hydrated rows and preserves cached text across edits and reorders', async () => {
    const specifier = `./fixtures/out/text-concat-${kind}.compiled.ts`;
    const { HydratedApp } = await import(specifier);
    registerRootFactory(HydratedApp, { id: 'HydratedApp', create: () => HydratedApp('HydratedApp', null) });
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML = renderToString(HydratedApp, { markers: true });
    document.body.append(host);
    const [first, second] = [...host.querySelectorAll('li')];
    const createElement = vi.spyOn(document, 'createElement');
    const createText = vi.spyOn(document, 'createTextNode');
    const insertBefore = vi.spyOn(host.querySelector('ul')!, 'insertBefore');
    mounted = mount('root', HydratedApp);
    expect([...host.querySelectorAll('li')]).toEqual([first, second]);
    expect(createElement).not.toHaveBeenCalled();
    expect(createText).not.toHaveBeenCalled();
    expect(insertBefore).not.toHaveBeenCalled();
    first!.click();
    first!.click();
    expect(first!.textContent).toBe('1:one!!');
    host.querySelector('button')!.click();
    expect([...host.querySelectorAll('li')]).toEqual([second, first]);
    first!.click();
    expect(first!.textContent).toBe('1:one!!!');
    expect(second!.textContent).toBe('2:two');
  });
});

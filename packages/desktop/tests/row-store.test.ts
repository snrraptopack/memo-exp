/** Ordinary mutation syntax, shared publication and accepted native row lifetimes. */
import { expect, test } from 'bun:test';
import * as core from '@memoized-dom/runtime/core';
import type { SourceReference } from '../src/host/protocol';
import {
  compiledOperations,
  createCompiledApplication,
  drainCompiled,
  moduleFactory,
} from './fixtures/compiled-application';

type Fixture = ReturnType<typeof createCompiledApplication>;

test.each([
  'store.items[index]!.done',
  '(store.items[index] as { done: boolean }).done',
  '(store.items[index] satisfies { done: boolean }).done',
])('typed indexed reads use the same owned store as mutations: %s', async condition => {
  const module = moduleFactory(`
    const store = { items: [{ id: 1, done: true }, { id: 2, done: false }] };
    export function increment() {
      for (let index = store.items.length - 1; index >= 0; index--) {
        if (${condition}) store.items.splice(index, 1);
      }
    }
    export function App() {
      return <main>
        <button data-action="reverse" onClick={() => { store.items.reverse(); }}>Reverse</button>
        <button data-action="clear" onClick={increment}>Clear completed</button>
        <p>{store.items.length}:{store.items[0].id}</p>
      </main>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    await click(fixture, 'reverse');
    const changes = await click(fixture, 'clear');
    expect(changes.some(operation => operation.op === 'text' && operation.value === '1:2')).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

function sourceFor(fixture: Fixture, action: string, owner = ''): SourceReference {
  const operation = compiledOperations(fixture).reverse().find(operation =>
    operation.op === 'setAttribute' &&
    operation.name.local === 'data-action' && operation.value === action &&
    operation.target.owner.id.includes(owner) && fixture.view.matchesSource(operation.target),
  );

  if (operation?.op !== 'setAttribute') throw new Error(`Missing live action: ${action}`);
  return operation.target;
}

async function mount(fixture: Fixture): Promise<void> {
  const mounted = fixture.candidate.publish(fixture.view.initialPublication);
  fixture.transport.accept(1);
  await mounted;
}

async function click(fixture: Fixture, action: string, owner = '') {
  const before = fixture.transport.sent.length;
  fixture.view.dispatch(sourceFor(fixture, action, owner), 'onClick', new Event('click'));
  fixture.application.run(core.commit);
  await drainCompiled(fixture, before);
  return compiledOperations(fixture, before);
}

test.each(['inline', 'spread', 'component', 'callback'])(
  'row field writes refresh sibling store readers and retain keyed identity: %s',
  async form => {
    const button = `<button data-action="toggle" onClick={() => { item.done = !item.done; }}>
      {item.done ? 'Done' : 'Open'}
    </button>`;
    const row = form === 'spread'
      ? `<button data-action="toggle" {...{onClick: () => { item.done = !item.done; }}}>{item.done ? 'Done' : 'Open'}</button>`
      : button;
    const module = moduleFactory(`
      const store = { items: [{ id: 'a', done: false }, { id: 'b', done: false }] };
      export function increment() {}
      function Row({item}) { return ${button}; }
      function List({items, renderItem}) { return <ul>{items.map(item => renderItem(item))}</ul>; }
      export function App() {
        return <main>
          <p>{store.items[0].done ? 'First completed' : 'First active'}</p>
          ${form === 'callback'
            ? `<List items={store.items} renderItem={item => <li key={item.id}>${row}</li>} />`
            : `<ul>{store.items.map(item => ${form === 'component'
              ? '<Row key={item.id} item={item} />'
              : `<li key={item.id}>${row}</li>`})}</ul>`}
        </main>;
      }
    `);
    const fixture = createCompiledApplication(module);

    try {
      await mount(fixture);
      const source = sourceFor(fixture, 'toggle', 'Row[s:a]');
      const changes = await click(fixture, 'toggle', 'Row[s:a]');
      expect(changes.some(operation => operation.op === 'text' && operation.value === 'Done')).toBe(true);
      expect(changes.some(operation => operation.op === 'text' && operation.value === 'First completed')).toBe(true);
      expect(changes.some(operation => operation.op === 'mount' || operation.op === 'retire')).toBe(false);
      expect(fixture.view.matchesSource(source)).toBe(true);
      expect(fixture.errors).toEqual([]);
    } finally {
      fixture.application.close();
    }
  },
);

test('store methods add, reorder and remove component rows while local state follows the key', async () => {
  const module = moduleFactory(`
    const store = { nextId: 3, items: [{ id: 1 }, { id: 2 }] };
    export function increment() { store.items.push({ id: store.nextId++ }); }
    function Row({item, index}) {
      let clicks = 0;
      return <li>
        <button data-action="local" onClick={() => { clicks++; }}>{item.id}:{index}:{clicks}</button>
      </li>;
    }
    export function App() {
      return <main>
        <button data-action="add" onClick={increment}>Add</button>
        <button data-action="reverse" onClick={() => { store.items.reverse(); }}>Reverse</button>
        <button data-action="remove" onClick={() => { store.items.splice(0, 1); }}>Remove first</button>
        <p>Rows: {store.items.length}</p>
        <ul>{store.items.map((item, index) => <Row key={item.id} item={item} index={index} />)}</ul>
      </main>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    const original = sourceFor(fixture, 'local', 'Row[n:1]');
    const local = await click(fixture, 'local', 'Row[n:1]');
    expect(local.some(operation => operation.op === 'text' && operation.value === '1:0:1')).toBe(true);
    const added = await click(fixture, 'add');
    expect(added.some(operation => operation.op === 'mount' && operation.owner.id.includes('Row[n:3]'))).toBe(true);
    expect(added.some(operation => operation.op === 'text' && operation.value === 'Rows: 3')).toBe(true);
    const reversed = await click(fixture, 'reverse');
    expect(reversed.some(operation => operation.op === 'text' && operation.value === '1:2:1')).toBe(true);
    expect(reversed.some(operation => operation.op === 'mount' || operation.op === 'retire')).toBe(false);
    expect(fixture.view.matchesSource(original)).toBe(true);
    const removed = sourceFor(fixture, 'local', 'Row[n:3]');
    await click(fixture, 'remove');
    expect(fixture.view.matchesSource(removed)).toBe(false);
    expect(fixture.view.matchesSource(original)).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test('mutating a row key reconciles its source and rejects the retired event address', async () => {
  const module = moduleFactory(`
    const store = { items: [{ id: 'a', title: 'Original' }] };
    export function increment() {}
    export function App() {
      return <ul>{store.items.map(item => <li key={item.id}>
        <button data-action="key" onClick={() => { item.id = 'changed'; }}>{item.title}</button>
      </li>)}</ul>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    const original = sourceFor(fixture, 'key');
    const changes = await click(fixture, 'key');
    expect(changes.some(operation => operation.op === 'retire' && operation.owner.id.includes('Row[s:a]'))).toBe(true);
    expect(changes.some(operation => operation.op === 'mount' && operation.owner.id.includes('Row[s:changed]'))).toBe(true);
    expect(fixture.view.matchesSource(original)).toBe(false);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test('execution guards preserve skipped writes, throwing completion and postfix return values', async () => {
  const module = moduleFactory(`
    const store = { value: 0 };
    export function increment() {}
    export function App({enabled}) {
      return <main>
        <button data-action="skip" onClick={() => { if (enabled) store.value++; }}>Maybe</button>
        <button data-action="throw" onClick={() => { store.value++; throw new Error('Stop'); }}>Throw</button>
        <button data-action="return" onClick={() => {
          try { return store.value++; } finally { store.value++; }
        }}>Return</button>
        <p>{store.value}</p>
      </main>;
    }
  `);
  const fixture = createCompiledApplication(module, [{ enabled: false }]);

  try {
    await mount(fixture);
    const before = fixture.transport.sent.length;
    await click(fixture, 'skip');
    expect(fixture.transport.sent).toHaveLength(before);
    expect(() => fixture.view.dispatch(sourceFor(fixture, 'throw'), 'onClick', new Event('click'))).toThrow('Stop');
    fixture.application.run(core.commit);
    expect(fixture.transport.sent).toHaveLength(before);

    const returned = fixture.view.dispatch(sourceFor(fixture, 'return'), 'onClick', new Event('click'));
    expect(returned).toBe(1);
    fixture.application.run(core.commit);
    await drainCompiled(fixture, before);
    expect(compiledOperations(fixture, before).some(operation => operation.op === 'text' && operation.value === '3')).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test('store cells stay isolated between native applications compiled from one module', async () => {
  const module = moduleFactory(`
    const store = { value: 0 };
    export function increment() { store.value++; }
    export function App() { return <button data-action="increment" onClick={increment}>{store.value}</button>; }
  `);
  const first = createCompiledApplication(module);
  const second = createCompiledApplication(module);

  try {
    await mount(first);
    await mount(second);
    await click(first, 'increment');
    expect(second.transport.sent).toHaveLength(1);
    const changed = await click(second, 'increment');
    expect(changed.some(operation => operation.op === 'text' && operation.value === '1')).toBe(true);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  } finally {
    first.application.close();
    second.application.close();
  }
});

test('guarded scalar cell writes retain postfix results and skipped logical assignments', async () => {
  const module = moduleFactory(`
    let value = 0;
    export function increment() { return value++; }
    export function App() {
      return <main>
        <button data-action="increment" onClick={increment}>Increment</button>
        <button data-action="logical" onClick={() => { return value ||= 10; }}>Initialize</button>
        <p>{value}</p>
      </main>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    const before = fixture.transport.sent.length;
    const returned = fixture.view.dispatch(sourceFor(fixture, 'increment'), 'onClick', new Event('click'));
    expect(returned).toBe(0);
    fixture.application.run(core.commit);
    await drainCompiled(fixture, before);
    expect(compiledOperations(fixture, before).some(operation => operation.op === 'text' && operation.value === '1')).toBe(true);

    const accepted = fixture.transport.sent.length;
    expect(fixture.view.dispatch(sourceFor(fixture, 'logical'), 'onClick', new Event('click'))).toBe(1);
    fixture.application.run(core.commit);
    expect(fixture.transport.sent).toHaveLength(accepted);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test.each(['const', 'let'])('plain %s array roots retain per-application storage while publishing method mutations', async kind => {
  const module = moduleFactory(`
    ${kind} items = [{ id: 1 }];
    export function increment() {
      ${kind === 'let' ? 'if (false) items = [];' : ''}
      items.push({ id: items.length + 1 });
    }
    export function App() {
      return <main><button data-action="add" onClick={increment}>Add</button>
        <p>{items.length}</p><ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
      </main>;
    }
  `);
  const first = createCompiledApplication(module);
  const second = createCompiledApplication(module);

  try {
    await mount(first);
    await mount(second);
    await click(first, 'add');
    expect(second.transport.sent).toHaveLength(1);
    const changed = await click(second, 'add');
    expect(changed.some(operation => operation.op === 'text' && operation.value === '2')).toBe(true);
    expect(changed.some(operation => operation.op === 'mount' && operation.owner.id.includes('Row[n:2]'))).toBe(true);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  } finally {
    first.application.close();
    second.application.close();
  }
});

test('read helpers do not publish receiver-method effects while rendering', async () => {
  const module = moduleFactory(`
    const store = { items: [1] };
    export function increment() { store.items.push(store.items.length + 1); }
    function size() { return store.items.slice().length; }
    export function App() {
      return <main><button data-action="add" onClick={increment}>Add</button><p>{size()}</p></main>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    expect(fixture.transport.sent).toHaveLength(1);
    const changed = await click(fixture, 'add');
    expect(changed.some(operation => operation.op === 'text' && operation.value === '2')).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test.each([false, true])('forwarded scalar callback props retain their caller instance writes (named=%s)', async named => {
  const module = moduleFactory(`
    export function increment() {}
    function Button({run}) { return <button data-action="increment" onClick={run}>Count</button>; }
    function Forward({run}) { return <Button {...{run}} />; }
    export function App() {
      let count = 0;
      ${named ? 'function update() { count++; }' : ''}
      return <main><p>{count}</p><Forward run={${named ? 'update' : '() => { count++; }'}} /></main>;
    }
  `);
  const fixture = createCompiledApplication(module);

  try {
    await mount(fixture);
    expect((await click(fixture, 'increment')).some(operation => operation.op === 'text' && operation.value === '1')).toBe(true);
    expect((await click(fixture, 'increment')).some(operation => operation.op === 'text' && operation.value === '2')).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

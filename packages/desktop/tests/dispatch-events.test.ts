import { expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import {
  createDesktopApplication,
  type NativeSceneEvent,
  type SceneInstance,
  type SceneTemplate,
  type SceneTransaction,
} from '../src';

async function setup(source: string) {
  const templates = new Map<string, SceneTemplate>();
  const transactions: SceneTransaction[] = [];
  const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
  const output = compileDesktop(source, { moduleId: 'events.tsx', runtimePath });
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`
  )) as { Counter(): SceneInstance };
  const app = createDesktopApplication({
    async install(template) {
      templates.set(template.id, template);
    },
    async commit(transaction) {
      transactions.push(transaction);
      return { sequence: transaction.sequence };
    },
  });
  const root = app.mount(module.Counter);
  await root.ready;
  const mounted = () =>
    transactions
      .flatMap((transaction) => transaction.operations)
      .filter((operation) => operation.kind === 'mount');
  const send = (id: string, type: string, fields: object = {}) => {
    for (const instance of mounted()) {
      const node = templates
        .get(instance.template)!
        .nodes.findIndex((node) => node.kind === 'element' && node.attributes?.id === id);
      if (node >= 0)
        return app.dispatchEvent({
          type: 'event',
          handle: instance.handle,
          node,
          payload: { type, ...fields },
        });
    }
    throw new Error(`Missing event target ${id}`);
  };
  return { app, root, send, transactions, templates };
}

it('bubbles across component owners with distinct currentTarget and one publication', async () => {
  const context = await setup(`function Child() {
  let own = 0;
  return (
    <button id="child" onClick={event => {
      own++;
      if (event.shiftKey) event.stopPropagation();
    }}>{own}</button>
  );
}
export function Counter() {
  let log = '';
  return (
    <main id="parent" onClick={event => {
      log = event.target.id + ':' + event.currentTarget.id + ':' + event.clientX;
    }}>
      <Child />
      <p>{log}</p>
    </main>
  );
}`);
  try {
    const before = context.transactions.length;
    await context.send('child', 'click', { clientX: 42 });
    expect(context.transactions).toHaveLength(before + 1);
    expect(context.transactions.at(-1)!.operations).toHaveLength(2);
    expect(context.transactions.at(-1)!.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'update',
          values: [{ slot: 0, value: 'child:parent:42' }],
        }),
        expect.objectContaining({ kind: 'update', values: [{ slot: 0, value: '1' }] }),
      ]),
    );
    await context.send('child', 'click', { shiftKey: true });
    expect(context.transactions.at(-1)!.operations).toEqual([
      expect.objectContaining({ kind: 'update', values: [{ slot: 0, value: '2' }] }),
    ]);
  } finally {
    await context.app.dispose();
  }
});

it('cancels keyboard defaults and bubbles a real submit event from input and button activation', async () => {
  const context = await setup(
    `export function Counter() {
  let submitted = 0;
  let source = '';
  return (
    <form id="form" onSubmit={event => {
      event.preventDefault();
      submitted++;
      source = event.submitter ? event.submitter.id : 'input';
    }}>
      <input id="draft" onKeyDown={event => {
        if (event.shiftKey) event.preventDefault();
      }} />
      <button id="add" type="submit">Add</button>
      <p>{submitted}</p>
      <p>{source}</p>
    </form>
  );
}`,
  );
  try {
    expect(await context.send('draft', 'keydown', { key: 'Enter', shiftKey: true })).toBe(true);
    expect(context.transactions).toHaveLength(1);
    await context.send('draft', 'keydown', { key: 'Enter' });
    expect(context.transactions.at(-1)!.operations).toEqual([
      expect.objectContaining({
        values: [
          { slot: 0, value: '1' },
          { slot: 1, value: 'input' },
        ],
      }),
    ]);
    await context.send('add', 'keydown', { key: 'Enter' });
    expect(context.transactions.at(-1)!.operations).toEqual([
      expect.objectContaining({
        values: [
          { slot: 0, value: '2' },
          { slot: 1, value: 'add' },
        ],
      }),
    ]);
    await context.send('add', 'click');
    expect(context.transactions.at(-1)!.operations).toEqual([
      expect.objectContaining({ values: [{ slot: 0, value: '3' }] }),
    ]);
    await context.send('draft', 'keydown', { key: 'Enter', isComposing: true });
    expect(context.transactions.at(-1)!.operations).toEqual([
      expect.objectContaining({ values: [{ slot: 0, value: '3' }] }),
    ]);
  } finally {
    await context.app.dispose();
  }
});

it('honors non-bubbling focus, non-cancelable notifications, space cancellation, and retires event targets', async () => {
  const context = await setup(
    `export function Counter() {
  let count = 0;
  return (
    <main onFocus={() => count += 100}>
      <button id="target"
        onFocus={event => {
          count++;
          event.preventDefault();
        }}
        onKeyDown={event => {
          if (event.key === ' ') event.preventDefault();
        }}
        onClick={() => count += 10}
      >Click</button>
      <p>{count}</p>
    </main>
  );
}`,
  );
  const target: NativeSceneEvent = {
    type: 'event',
    handle: context.root.handle,
    node: 1,
    payload: { type: 'focus' },
  };
  expect(await context.app.dispatchEvent(target)).toBe(false);
  expect(context.transactions.at(-1)!.operations).toEqual([
    expect.objectContaining({ values: [{ slot: 0, value: '1' }] }),
  ]);
  await context.send('target', 'keydown', { key: ' ' });
  await context.send('target', 'keyup', { key: ' ' });
  expect(context.transactions.at(-1)!.operations).toEqual([
    expect.objectContaining({ values: [{ slot: 0, value: '1' }] }),
  ]);
  await context.send('target', 'keydown', { key: ' ', cancelable: false });
  await context.send('target', 'keyup', { key: ' ' });
  expect(context.transactions.at(-1)!.operations).toEqual([
    expect.objectContaining({ values: [{ slot: 0, value: '11' }] }),
  ]);
  await context.app.dispose();
  await expect(context.app.dispatchEvent(target)).rejects.toThrow('retired owner');
});

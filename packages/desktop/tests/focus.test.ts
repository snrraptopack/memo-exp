import { expect, it } from 'bun:test';
import {
  createDesktopApplication,
  mountScene,
  type DesktopHost,
  type SceneElement,
  type SceneTemplate,
} from '../src';
import { createPublicationQueue } from '../src/runtime/publication';

const template: SceneTemplate = {
  id: 'focus-ref',
  nodes: [{ kind: 'element', tag: 'button', parent: null, text: '' }],
  slots: [],
  events: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('uses accepted refs for focus and blur without creating scene transactions', async () => {
  const calls: unknown[] = [];
  let ref!: SceneElement;
  const processed = deferred<void>();
  let focusCalls = 0;
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      calls.push(transaction.sequence);
      return { sequence: transaction.sequence };
    },
    async setFocus(handle, node, focused) {
      calls.push({ handle, node, focused });
      if (++focusCalls === 3) processed.resolve();
    },
  });
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(element) {
        ref = element;
        expect(element.focus()).toBeUndefined();
      } }],
    }));
    await owner.ready;
    expect(ref.focus()).toBeUndefined();
    expect(ref.blur()).toBeUndefined();
    expect(() => ref.focus({ preventScroll: true })).toThrow('focus options');
    await processed.promise;
    expect(calls).toEqual([1,
      { handle: owner.handle, node: 0, focused: true },
      { handle: owner.handle, node: 0, focused: true },
      { handle: owner.handle, node: 0, focused: false },
    ]);
    await owner.dispose();
    expect(ref.focus()).toBeUndefined();
    expect(ref.blur()).toBeUndefined();
    await Bun.sleep(0);
    expect(focusCalls).toBe(3);
  } finally {
    await app.dispose();
  }
});

it('orders control requests after requested publications and permits retry after native refusal', async () => {
  const gate = deferred<void>();
  const calls: string[] = [];
  let refused = true;
  const host: DesktopHost = {
    async install() {},
    async commit(transaction) {
      calls.push('commit');
      await gate.promise;
      return { sequence: transaction.sequence };
    },
    async setFocus(_handle, _node, focused) {
      calls.push(focused ? 'focus' : 'blur');
      if (refused) throw new Error('native focus refusal');
    },
  };
  const queue = createPublicationQueue(host);
  const handle = { id: 1, generation: 1 };
  const publication = queue.publish(() => ({
    operation: { kind: 'mount', handle, template: template.id, values: [] },
    accept() { calls.push('accept'); },
    reject() { throw new Error('Unexpected write refusal'); },
  }));
  const failure = queue.setFocus(handle, 0, true).then(() => undefined, error => error as Error);
  await Bun.sleep(0);
  expect(calls).toEqual(['commit']);
  gate.resolve();
  await publication;
  expect((await failure)?.message).toBe('native focus refusal');
  refused = false;
  await queue.setFocus(handle, 0, true);
  await queue.setFocus(handle, 0, false);
  expect(calls).toEqual(['commit', 'accept', 'focus', 'focus', 'blur']);
});

it('keeps queued focus internal and makes captured disconnected refs inert', async () => {
  const arrived = deferred<void>();
  const complete = deferred<void>();
  let ref!: SceneElement;
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) { return { sequence: transaction.sequence }; },
    async setFocus() { arrived.resolve(); await complete.promise; },
  });
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(element) { ref = element; } }],
    }));
    await owner.ready;
    expect(ref.focus()).toBeUndefined();
    await arrived.promise;
    const retirement = owner.dispose();
    complete.resolve();
    await retirement;
    expect(ref.focus()).toBeUndefined();
  } finally {
    complete.resolve();
    await app.dispose();
  }
});

it('reports asynchronous native failure through the existing application error boundary', async () => {
  const failed = deferred<void>();
  let ref!: SceneElement;
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) { return { sequence: transaction.sequence }; },
    async setFocus() { failed.resolve(); throw new Error('native focus failed'); },
  });
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(element) { ref = element; } }],
    }));
    await owner.ready;
    expect(ref.focus()).toBeUndefined();
    await failed.promise;
    await Bun.sleep(0);
    await expect(app.flush()).rejects.toThrow('native focus failed');
  } finally {
    await app.dispose();
  }
});

it('requires the explicit native focus host capability', async () => {
  const queue = createPublicationQueue({
    async install() {},
    async commit(transaction) { return { sequence: transaction.sequence }; },
  });
  await expect(queue.setFocus({ id: 1, generation: 1 }, 0, true)).rejects.toThrow('does not support');
});

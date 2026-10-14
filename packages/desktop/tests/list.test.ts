import { expect, test } from 'bun:test';
import {
  cleanup,
  commit,
  invalidateEntity,
  setScheduler,
} from '@memoized-dom/runtime/core';
import { NativeApplication } from '../src/runtime/application';
import { NativeList } from '../src/runtime/list';
import { NativeView, child, type NativeFrame } from '../src/runtime/view';
import { PublicationClient } from '../src/host/client';
import type { Operation, Publication, SourceReference } from '../src/host/protocol';
import { ManualTransport } from './fixtures/manual-transport';

interface Item {
  readonly id: unknown;
  label: string;
}

function fixture(initial: readonly Item[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
]) {
  const transport = new ManualTransport();
  const errors: unknown[] = [];
  const cleaned: string[] = [];
  const clicks: string[] = [];
  const created: Array<{ key: unknown; frame: NativeFrame; view: NativeView }> = [];
  let items = initial;
  let failKey: unknown = Symbol('no failure');
  const application = new NativeApplication(new PublicationClient(transport), {
    scheduleFrame: null,
    visible: () => true,
    reportError: error => errors.push(error),
  });
  application.run(() => setScheduler(() => {}));
  let list!: NativeList<Item>;

  const candidate = application.prepare(() => {
    list = new NativeList({
      application,
      owner: { id: 'App/List', generation: 1 },
      parent: null,
      reportError: error => errors.push(error),
    }, () => items, (frame, firstItem, firstIndex) => {
      if (firstItem.id === failKey) throw new Error('row factory failed');

      let item = firstItem;
      let index = firstIndex;
      let localClicks = 0;
      const onClick = () => {
        clicks.push(item.label);
        localClicks++;
        invalidateEntity(view.ownerId);
      };
      const view = new NativeView(frame, {
        key: 'list-row',
        nodes: [
          { parent: null, node: {
            kind: 'element',
            name: { namespace: 'http://www.w3.org/1999/xhtml', local: 'button' },
            attributes: [],
          } },
          { parent: 0, node: { kind: 'text', value: '' } },
          { parent: 0, node: { kind: 'comment', value: 'child' } },
        ],
      }, () => [
        { kind: 'text', source: 1, value: `${item.label}:${index}:${localClicks}` },
        { kind: 'attributes', source: 0, value: { onClick } },
      ], [child('Detail', 2, nestedFrame => {
        const nested = new NativeView(nestedFrame, {
          key: 'list-detail',
          nodes: [{ parent: null, node: { kind: 'text', value: 'Detail' } }],
        }, () => []);

        // Deferred candidates must not register cleanup in the live graph.
        if (!nestedFrame.deferCore) {
          cleanup(nested.ownerId, () => cleaned.push(nested.ownerId));
        }

        return nested;
      })]);

      created.push({ key: item.id, frame, view });

      return {
        view,
        update(nextItem, nextIndex) {
          item = nextItem;
          index = nextIndex;
        },
      };
    }, item => item.id);

    return list;
  }, {
    accepted() { list.acceptInitial(); },
    activated() { list.activateUpdates(); },
  });

  const source = (key: unknown): SourceReference => ({
    owner: [...created].reverse().find(row => row.key === key)!.frame.owner,
    source: 0,
  });

  return {
    application, candidate, list, transport, errors, cleaned, clicks, created, source,
    setItems(next: readonly Item[]) { items = next; },
    failOn(key: unknown) { failKey = key; },
    render() { application.run(() => { list.updateFromOwner(); commit(); }); },
    flush() { application.run(commit); },
    sent(index: number): Publication { return JSON.parse(transport.sent[index]!); },
    async mount() {
      const pending = candidate.publish(list.initialPublication);
      transport.accept(1);
      await pending;
    },
    async drain(from: number) {
      // The client admits one wire publication at a time. Accepting its reply
      // pumps the next queued row, so inspect newly sent frames after each turn.
      for (let index = from; index < transport.sent.length; index++) {
        const sent = JSON.parse(transport.sent[index]!) as { sequence: number };
        transport.accept(sent.sequence);
        await Bun.sleep(0);
      }

      await list.publication();
    },
  };
}

function observe(promise: Promise<unknown>) {
  return promise.then(value => value, error => error);
}

test('native rows reorder without remounting or losing local state and nested owners', async () => {
  const f = fixture();
  try {
    await f.mount();
    const alpha = f.source('a');
    const beta = f.source('b');
    f.list.dispatch(alpha, 'onClick', new Event('click'));
    f.flush();
    f.transport.accept(2);
    await f.list.publication();

    f.setItems([{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Alpha' }]);
    f.render();
    const pending = f.list.publication();
    expect(f.sent(2).operations).toEqual([{ op: 'moveToEnd', owner: alpha.owner }]);
    expect(f.created).toHaveLength(2);
    expect(f.cleaned).toEqual([]);
    expect(f.list.matchesSource(beta)).toBe(true);
    f.transport.accept(3);
    await pending;
    f.flush();
    await f.drain(3);
    expect(f.transport.sent.slice(3).map(text => JSON.parse(text).operations).flat()).toContainEqual({
      op: 'text', target: { owner: alpha.owner, source: 1 }, value: 'Alpha:1:1',
    });
    expect(f.application.runtime.state.registry.has(alpha.owner.id + '/Detail')).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { f.application.close(); }
});

test('unchanged key order publishes no moves but retained item fields still refresh', async () => {
  const alpha = { id: 'a', label: 'Alpha' };
  const f = fixture([alpha]);
  try {
    await f.mount();
    f.render();
    // Neither structure nor unchanged content needs a wire publication.
    expect(f.transport.sent.slice(1).map(text => JSON.parse(text).operations).flat()).toEqual([]);
    if (f.transport.sent.length > 1) f.transport.accept(2);
    await f.list.publication();

    alpha.label = 'Edited';
    f.render();
    const last = f.sent(f.transport.sent.length - 1);
    expect(last.operations).toContainEqual({
      op: 'text', target: { owner: f.source('a').owner, source: 1 }, value: 'Edited:0:0',
    });
    expect(f.created).toHaveLength(1);
    f.transport.accept(f.transport.sent.length);
    await f.list.publication();
  } finally { f.application.close(); }
});

test('refused additions/removals preserve accepted handlers, bindings and core graph', async () => {
  const f = fixture();
  try {
    await f.mount();
    const alpha = f.source('a');
    const beta = f.source('b');
    const registry = [...f.application.runtime.state.registry.keys()];
    f.setItems([{ id: 'b', label: 'Changed Beta' }, { id: 'c', label: 'Gamma' }]);
    f.render();
    const gamma = f.source('c');
    const pending = observe(f.list.publication());
    expect([...f.application.runtime.state.registry.keys()]).toEqual(registry);
    expect(f.list.matchesSource(gamma)).toBe(false);
    f.list.dispatch(beta, 'onClick', new Event('click'));
    expect(f.clicks).toEqual(['Beta']);
    f.transport.refuse(2);
    expect(await pending).toMatchObject({ name: 'PublicationRefusedError' });
    expect([...f.application.runtime.state.registry.keys()]).toEqual(registry);
    expect(f.list.matchesSource(alpha)).toBe(true);
    expect(f.list.matchesSource(gamma)).toBe(false);
    expect(() => f.created[2]!.view.attachCore()).toThrow('disposed');
    expect(f.cleaned).toEqual([]);
    expect(f.errors).toHaveLength(1);
    f.flush();
    // A click while frozen still renders its final local value after refusal.
    f.transport.accept(2);
    await f.list.publication();
  } finally { f.application.close(); }
});

test('accepted removal retires descendants and reinserted keys receive a fresh generation', async () => {
  const f = fixture();
  try {
    await f.mount();
    const original = f.source('a');
    f.setItems([{ id: 'b', label: 'Beta' }]);
    f.render();
    const pending = f.list.publication();
    expect(f.application.runtime.state.registry.has(original.owner.id)).toBe(true);
    f.transport.accept(2);
    await pending;
    expect(f.application.runtime.state.registry.has(original.owner.id)).toBe(false);
    expect(f.application.runtime.state.registry.has(original.owner.id + '/Detail')).toBe(false);
    expect(f.cleaned).toEqual([original.owner.id + '/Detail']);
    f.flush();
    // The retained row now has index zero.
    f.transport.accept(3);
    await f.list.publication();

    f.setItems([{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Again' }]);
    f.render();
    const reinserted = f.source('a');
    expect(reinserted.owner.id).toBe(original.owner.id);
    expect(reinserted.owner.generation).toBeGreaterThan(original.owner.generation);
    expect(f.list.matchesSource(reinserted)).toBe(false);
    f.transport.accept(4);
    await f.list.publication();
    expect(f.list.matchesSource(original)).toBe(false);
    f.list.dispatch(reinserted, 'onClick', new Event('click'));
    expect(f.clicks).toEqual(['Again']);
  } finally { f.application.close(); }
});

test('pending structure coalesces the latest source without exposing staged rows', async () => {
  const f = fixture([{ id: 'a', label: 'Alpha' }]);
  try {
    await f.mount();
    f.setItems([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]);
    f.render();
    const first = f.list.publication();
    f.setItems([{ id: 'c', label: 'Final' }]);
    f.render();
    expect(f.transport.sent).toHaveLength(2);
    expect(f.created).toHaveLength(2);
    f.transport.accept(2);
    await first;
    f.flush();
    expect(f.created).toHaveLength(3);
    expect(f.sent(2).operations.filter(operation => operation.op === 'retire')).toHaveLength(2);
    const final = f.list.publication();
    f.transport.accept(3);
    await final;
    f.list.dispatch(f.source('c'), 'onClick', new Event('click'));
    expect(f.clicks).toEqual(['Final']);
    expect([...f.application.runtime.state.registry.keys()]).toEqual([
      'App/List', 'App/List/Row[s:c]', 'App/List/Row[s:c]/Detail',
    ]);
  } finally { f.application.close(); }
});

test('duplicate keys reject before factories or native publication and typed keys stay distinct', async () => {
  const objectKey = {};
  const f = fixture([
    { id: 1, label: 'Number' }, { id: '1', label: 'String' },
    { id: 1n, label: 'Bigint' }, { id: true, label: 'Boolean' },
    { id: 'x/y]', label: 'Escaped' }, { id: objectKey, label: 'Object' },
  ]);
  try {
    await f.mount();
    expect(new Set(f.created.map(row => row.frame.owner.id)).size).toBe(6);
    expect(f.source('x/y]').owner.id).toEndWith('Row[s:x%2Fy%5D]');
    const original = f.source(objectKey);
    f.setItems([{ id: 'new', label: 'New' }, { id: objectKey, label: 'Object' }, { id: objectKey, label: 'Duplicate' }]);
    expect(() => f.render()).toThrow('duplicate keys');
    expect(f.created).toHaveLength(6);
    expect(f.transport.sent).toHaveLength(1);
    expect(f.list.matchesSource(original)).toBe(true);
  } finally { f.application.close(); }
});

test('factory failures discard previously staged rows without altering accepted ownership', async () => {
  const f = fixture();
  try {
    await f.mount();
    const registry = [...f.application.runtime.state.registry.keys()];
    f.failOn('broken');
    f.setItems([{ id: 'new', label: 'New' }, { id: 'broken', label: 'Broken' }]);
    expect(() => f.render()).toThrow('row factory failed');
    expect(f.transport.sent).toHaveLength(1);
    expect([...f.application.runtime.state.registry.keys()]).toEqual(registry);
    expect(() => f.created[2]!.view.attachCore()).toThrow('disposed');
  } finally { f.application.close(); }
});

test('closing with a structural publication pending disposes staged and accepted rows', async () => {
  const f = fixture();
  await f.mount();
  f.setItems([{ id: 'new', label: 'New' }]);
  f.render();
  const pending = observe(f.list.publication());
  f.application.close();
  expect(await pending).toMatchObject({ code: 'closed' });
  expect(f.application.runtime.state.registry.size).toBe(0);
  expect(() => f.created[2]!.view.attachCore()).toThrow('disposed');
  expect(f.cleaned).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

test('ancestor suspension continues to freeze accepted rows until the ancestor resumes', async () => {
  const f = fixture([{ id: 'a', label: 'Alpha' }]);
  try {
    await f.mount();
    f.setItems([{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Moved' }]);
    f.render();
    f.application.run(() => f.list.suspendUpdates());
    const pending = f.list.publication();
    f.transport.accept(2);
    await pending;
    f.flush();
    expect(f.transport.sent).toHaveLength(2);

    f.application.run(() => f.list.resumeUpdates());
    f.flush();
    expect(f.sent(2).operations).toContainEqual({
      op: 'text', target: { owner: f.source('a').owner, source: 1 }, value: 'Moved:1:0',
    });
    await f.drain(2);
    expect(f.errors).toEqual([]);
  } finally { f.application.close(); }
});

test('a source write before initial acceptance replays after the rows become live', async () => {
  const f = fixture([{ id: 'a', label: 'Alpha' }]);
  try {
    const initial = f.candidate.publish(f.list.initialPublication);
    f.setItems([{ id: 'b', label: 'Final' }]);
    f.render();
    expect(f.transport.sent).toHaveLength(1);
    f.transport.accept(1);
    await initial;
    f.flush();
    expect(f.sent(1).operations.some(operation => operation.op === 'retire')).toBe(true);
    await f.drain(1);
    f.list.dispatch(f.source('b'), 'onClick', new Event('click'));
    expect(f.clicks).toEqual(['Final']);
  } finally { f.application.close(); }
});

test('reentrant row cleanup cannot reattach candidates after retiring the containing list', async () => {
  const f = fixture([{ id: 'a', label: 'Alpha' }]);
  try {
    await f.mount();
    f.application.run(() => cleanup(f.source('a').owner.id, () => f.list.retireCore()));
    f.setItems([{ id: 'b', label: 'Beta' }]);
    f.render();
    const pending = f.list.publication();
    f.transport.accept(2);
    await pending;
    expect(f.application.runtime.state.registry.size).toBe(0);
    expect(() => f.created[1]!.view.attachCore()).toThrow('disposed');
    expect(f.errors).toEqual([]);
  } finally { f.application.close(); }
});

/** Apply just the wire's range operations to an order oracle, not a JS tree. */
function applyOrder(order: string[], operations: readonly Operation[]): void {
  for (const operation of operations) {
    if (operation.op === 'mount' && !operation.owner.id.endsWith('/Detail')) {
      order.push(operation.owner.id);
    } else if (operation.op === 'retire') {
      order.splice(order.indexOf(operation.owner.id), 1);
    } else if (operation.op === 'moveBefore' || operation.op === 'moveToEnd') {
      order.splice(order.indexOf(operation.owner.id), 1);
      const index = operation.op === 'moveBefore' ? order.indexOf(operation.before.id) : order.length;
      order.splice(index, 0, operation.owner.id);
    }
  }
}

test('mixed native moves/additions/removals match every desired order', async () => {
  const f = fixture([]);
  const order: string[] = [];
  try {
    await f.mount();
    const cases = [
      ['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], ['b', 'a', 'd', 'c'],
      ['c', 'new', 'a', 'b'], ['new', 'b'], ['first', 'new', 'b', 'last'], [], ['a'],
    ];

    for (const keys of cases) {
      f.setItems(keys.map(id => ({ id, label: id })));
      const sentBefore = f.transport.sent.length;
      f.render();
      applyOrder(order, f.sent(sentBefore).operations);
      const pending = f.list.publication();
      f.transport.accept(sentBefore + 1);
      await pending;
      expect(order).toEqual(keys.map(key => f.source(key).owner.id));
      f.flush();
      // Drain retained text/handler publications before the next structural batch.
      await f.drain(sentBefore + 1);
    }

    expect(f.errors).toEqual([]);
  } finally { f.application.close(); }
});

test('a deferred list attaches parent before rows through the existing registry', () => {
  const f = fixture([]);
  try {
    const list = f.application.run(() => new NativeList<Item>({
      application: f.application,
      owner: { id: 'Deferred', generation: 1 },
      parent: null,
      deferCore: true,
      reportError: error => f.errors.push(error),
    }, () => [{ id: 'a', label: 'Alpha' }], (frame, item) => ({
      view: new NativeView(frame, {
        key: 'deferred-row',
        nodes: [{ parent: null, node: { kind: 'text', value: item.label } }],
      }, () => []),
      update() {},
    }), item => item.id));
    expect(f.application.runtime.state.registry.has('Deferred')).toBe(false);
    f.application.run(() => {
      list.attachCore();
      expect(f.application.runtime.state.registry.has('Deferred/Row[s:a]')).toBe(true);
      list.retireCore();
    });
    expect(f.application.runtime.state.registry.has('Deferred')).toBe(false);
  } finally { f.application.close(); }
});

test('failed initial deferred creation disposes completed candidates outside the live core', () => {
  const f = fixture([]);
  const staged: NativeView[] = [];
  try {
    expect(() => f.application.run(() => new NativeList<Item>({
      application: f.application,
      owner: { id: 'Deferred', generation: 1 },
      parent: null,
      deferCore: true,
      reportError: error => f.errors.push(error),
    }, () => [{ id: 'a', label: 'Alpha' }, { id: 'broken', label: 'Broken' }], (frame, item) => {
      if (item.id === 'broken') throw new Error('initial row failed');

      const view = new NativeView(frame, {
        key: 'staged-row',
        nodes: [{ parent: null, node: { kind: 'text', value: item.label } }],
      }, () => []);
      staged.push(view);
      return { view, update() {} };
    }, item => item.id))).toThrow('initial row failed');
    expect(f.application.runtime.state.registry.has('Deferred')).toBe(false);
    expect(f.transport.sent).toHaveLength(0);
    expect(() => staged[0]!.attachCore()).toThrow('disposed');
  } finally { f.application.close(); }
});

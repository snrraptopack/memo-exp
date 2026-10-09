import { expect, it } from 'bun:test';
import { createDesktopApplication, mountScene, sceneEvent, type DesktopHost, type SceneInstance, type SceneTemplate, type SceneTransaction } from '../src';

const template: SceneTemplate = { id: 'batch-owner', nodes: [
  { kind: 'element', tag: 'button', parent: null, text: '' }, { kind: 'text', parent: 0, text: '' },
], slots: [{ node: 1, type: 'text' }], events: [{ node: 0, type: 'click' }] };

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const rejection = (promise: Promise<unknown>) => promise.then(() => { throw new Error('Expected rejection'); }, error => error as Error);

function fixture() {
  const transactions: SceneTransaction[] = [];
  let reject = false;
  let blocked: ReturnType<typeof defer> | undefined;
  let arrived: ReturnType<typeof defer> | undefined;
  const host: DesktopHost = { async install() {}, async commit(transaction) {
    transactions.push(transaction);
    arrived?.resolve();
    await blocked?.promise;
    if (reject) { reject = false; throw new Error('rejected batch'); }
    return { sequence: transaction.sequence };
  } };
  const app = createDesktopApplication(host);
  const owner = () => {
    let count = 0;
    let reads = 0;
    let invalid = false;
    const instance = app.mount(() => mountScene(template,
      [{ slot: 0, sources: ['count'], read() { reads++; if (invalid) throw new Error('bad destination'); return count; } }],
      [sceneEvent(() => count++, ['count'])]));
    return { instance, get reads() { return reads; }, invalid(value: boolean) { invalid = value; } };
  };
  return { app, transactions, owner, reject() { reject = true; }, block() {
    blocked = defer(); arrived = defer();
    return { arrived: arrived.promise, release() { blocked!.resolve(); blocked = undefined; arrived = undefined; } };
  } };
}

it('batches mounts, independent updates, and disposal without reading unrelated owners', async () => {
  const f = fixture(); const a = f.owner(); const b = f.owner(); const untouched = f.owner();
  await Promise.all([a.instance.ready, b.instance.ready, untouched.instance.ready]);
  expect(f.transactions).toHaveLength(1);
  expect(f.transactions[0]!.operations.map(operation => operation.kind)).toEqual(['mount', 'mount', 'mount']);
  await Promise.all([a.instance.dispatch(0), b.instance.dispatch(0)]);
  expect(f.transactions).toHaveLength(2);
  expect(f.transactions[1]!.operations).toEqual([
    { kind: 'update', handle: a.instance.handle, values: [{ slot: 0, value: '1' }] },
    { kind: 'update', handle: b.instance.handle, values: [{ slot: 0, value: '1' }] },
  ]);
  expect(untouched.reads).toBe(1);
  await f.app.dispose();
  expect(f.transactions).toHaveLength(3);
  expect(f.transactions[2]!.operations.map(operation => operation.kind)).toEqual(['dispose', 'dispose', 'dispose']);
});

it('keeps all values pending after host rejection and retries one batch at the same sequence', async () => {
  const f = fixture(); const a = f.owner(); const b = f.owner();
  await Promise.all([a.instance.ready, b.instance.ready]);
  f.reject();
  const errors = await Promise.all([rejection(a.instance.dispatch(0)), rejection(b.instance.dispatch(0))]);
  expect(errors.map(error => error.message)).toEqual(['rejected batch', 'rejected batch']);
  await f.app.flush();
  expect(f.transactions[2]).toEqual(f.transactions[1]);
  await f.app.flush();
  expect(f.transactions).toHaveLength(3);
  await f.app.dispose();
});

it('preserves callback order and results while coalescing repeated pure writes on one owner', async () => {
  const transactions: SceneTransaction[] = [];
  const calls: number[] = [];
  const app = createDesktopApplication({ async install() {}, async commit(transaction) {
    transactions.push(transaction); return { sequence: transaction.sequence };
  } });
  let count = 0;
  const a = app.mount(() => mountScene(template, [{ slot: 0, sources: ['count'], read: () => count }],
    [sceneEvent(() => { calls.push(count); return count++; }, ['count'])]));
  await a.ready;
  expect(await Promise.all([a.dispatch(0), a.dispatch(0), a.dispatch(0)])).toEqual([0, 1, 2]);
  expect(calls).toEqual([0, 1, 2]);
  expect(transactions).toHaveLength(2);
  expect(transactions[1]!.operations).toEqual([{ kind: 'update', handle: a.handle, values: [{ slot: 0, value: '3' }] }]);
  await app.dispose();
});

it('publishes writes before a callback failure together with successful sibling writes', async () => {
  const transactions: SceneTransaction[] = [];
  const app = createDesktopApplication({ async install() {}, async commit(transaction) {
    transactions.push(transaction); return { sequence: transaction.sequence };
  } });
  const owner = (fail: boolean) => app.mount(() => {
    let count = 0;
    return mountScene(template, [{ slot: 0, sources: ['count'], read: () => count }],
      [sceneEvent(() => { count++; if (fail) throw new Error('authored failure'); }, ['count'])]);
  });
  const a = owner(true); const b = owner(false);
  await Promise.all([a.ready, b.ready]);
  const result = await Promise.all([rejection(a.dispatch(0)), b.dispatch(0)]);
  expect((result[0] as Error).message).toBe('authored failure');
  expect(transactions).toHaveLength(2);
  expect(transactions[1]!.operations).toHaveLength(2);
  expect(transactions[1]!.operations.every(operation => 'values' in operation && operation.values[0]!.value === '1')).toBe(true);
  await app.dispose();
});

it('prepares every owner before publishing and restores earlier owners when a later read throws', async () => {
  const f = fixture(); const a = f.owner(); const b = f.owner();
  await Promise.all([a.instance.ready, b.instance.ready]);
  b.invalid(true);
  const errors = await Promise.all([rejection(a.instance.dispatch(0)), rejection(b.instance.dispatch(0))]);
  expect(errors.map(error => error.message)).toEqual(['bad destination', 'bad destination']);
  expect(f.transactions).toHaveLength(1);
  b.invalid(false);
  await f.app.flush();
  expect(f.transactions[1]!.operations).toHaveLength(2);
  expect(f.transactions[1]!.operations.every(operation => 'values' in operation && operation.values[0]!.value === '1')).toBe(true);
  await f.app.dispose();
});

it('preserves later invalidations while an accepted or rejected batch is in flight', async () => {
  for (const rejected of [false, true]) {
    const f = fixture(); const a = f.owner(); const b = f.owner();
    await Promise.all([a.instance.ready, b.instance.ready]);
    const gate = f.block(); if (rejected) f.reject();
    const first = Promise.allSettled([a.instance.dispatch(0), b.instance.dispatch(0)]);
    await gate.arrived;
    const second = Promise.all([a.instance.dispatch(0), b.instance.dispatch(0)]);
    gate.release(); await first; await second;
    expect(f.transactions[2]!.sequence).toBe(rejected ? 2 : 3);
    expect(f.transactions[2]!.operations).toHaveLength(2);
    expect(f.transactions[2]!.operations.every(operation => 'values' in operation && operation.values[0]!.value === '2')).toBe(true);
    await f.app.dispose();
  }
});

it('lets retirement cancel an update that has not been prepared without reviving its owner', async () => {
  const f = fixture(); const a = f.owner();
  await a.instance.ready;
  const update = a.instance.dispatch(0);
  await Promise.resolve(); // The callback runs before retirement; its flush is still queued.
  const retired = a.instance.dispose();
  await Promise.all([update, retired]);
  expect(f.transactions.map(transaction => transaction.operations.map(operation => operation.kind))).toEqual([['mount'], ['dispose']]);
  expect(a.instance.mounted).toBe(false);
  expect((await rejection(a.instance.dispatch(0))).message).toContain('disposed owner');
  await f.app.dispose();
});

it('orders new template installation after already requested publication', async () => {
  const commands: string[] = [];
  const host: DesktopHost = { async install(template) { commands.push(`install:${template.id}`); }, async commit(transaction) {
    commands.push(transaction.operations.map(operation => operation.kind).join(','));
    return { sequence: transaction.sequence };
  } };
  const app = createDesktopApplication(host);
  const a = app.mount(() => mountScene(template, [{ slot: 0, sources: null, read: () => 'a' }], [sceneEvent(() => {}, null)]));
  await a.ready;
  const removal = a.dispose();
  // Let disposal request its batch, then place an installation barrier.
  await Promise.resolve(); await Promise.resolve();
  const b = app.mount(() => mountScene({ ...template, id: 'second-template' }, [{ slot: 0, sources: null, read: () => 'b' }], [sceneEvent(() => {}, null)]));
  await Promise.all([removal, b.ready]);
  expect(commands).toEqual(['install:batch-owner', 'mount', 'dispose', 'install:second-template', 'mount']);
  await app.dispose();
});

it('stops publication after a mismatched acknowledgment instead of reusing an ambiguous sequence', async () => {
  let commits = 0;
  const app = createDesktopApplication({ async install() {}, async commit(transaction) {
    commits++; return { sequence: commits === 1 ? transaction.sequence : transaction.sequence + 1 };
  } });
  let count = 0;
  const a: SceneInstance = app.mount(() => mountScene(template, [{ slot: 0, sources: ['count'], read: () => count }], [sceneEvent(() => count++, ['count'])]));
  await a.ready;
  expect((await rejection(a.dispatch(0))).message).toContain('wrong transaction');
  expect((await rejection(a.flush())).message).toContain('wrong transaction');
  expect(commits).toBe(2);
  expect((await rejection(app.dispose())).message).toContain('disposal failed');
});

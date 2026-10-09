import { expect, it } from 'bun:test';
import { createRequestQueue, requestLimits } from '../src/bridge/request-queue';
import { createProcessHost } from '../src/bridge/process';
import { createDesktopApplication, mountScene, sceneEvent, DesktopConnectionError, type SceneTemplate } from '../src';

const turn = async () => { await Promise.resolve(); await Promise.resolve(); };
const rejected = (promise: Promise<unknown>) => promise.then(() => { throw new Error('Expected rejection'); }, error => error as Error);

it('bounds admitted requests and releases capacity after responses without reordering writes', async () => {
  const written: string[] = [];
  const queue = createRequestQueue({ maxPendingRequests: 2, maxPendingBytes: 128, maxInFlightRequests: 1 }, async line => { written.push(line); }, error => { throw error; });
  const first = queue.enqueue(1, 'first', 'inspect', 0); const second = queue.enqueue(2, 'second', 'inspect', 0);
  expect((await rejected(queue.enqueue(3, 'overflow', 'inspect', 0))).message).toContain('before request publication');
  expect(written).toEqual(['first']); queue.settle(1, 'one'); await turn();
  const third = queue.enqueue(4, 'third', 'inspect', 0); expect(written).toEqual(['first', 'second']);
  queue.settle(2, 'two'); await turn(); expect(written).toEqual(['first', 'second', 'third']); queue.settle(4, 'three');
  expect(await Promise.all([first, second, third])).toEqual(['one', 'two', 'three']); expect(queue.size).toBe(0);
});

it('bounds UTF-8 bytes and reserves finite control/shutdown admission under a diagnostic flood', async () => {
  const queue = createRequestQueue({ maxPendingRequests: 1, maxPendingBytes: 8, maxInFlightRequests: 1 }, async () => {}, () => {});
  expect((await rejected(queue.enqueue(1, '🙂🙂x', 'inspect', 0))).message).toContain('capacity');
  const promises = [queue.enqueue(2, '🙂🙂', 'inspect', 0), queue.enqueue(3, 'apply', 'apply', 0), queue.enqueue(4, 'ack', 'acknowledge', 0)];
  expect((await rejected(queue.enqueue(5, 'extra', 'acknowledge', 0))).message).toContain('capacity');
  promises.push(queue.enqueue(6, 'shutdown', 'shutdown', 0));
  expect((await rejected(queue.enqueue(7, 'extra', 'shutdown', 0))).message).toContain('capacity');
  expect(queue.size).toBe(4);
  const results = promises.map(rejected); queue.fail(new Error('connection failed'));
  expect((await Promise.all(results)).every(error => error.message === 'connection failed')).toBe(true); expect(queue.size).toBe(0);
});

it('waits for each pipe flush before starting another writer, even when the response arrives early', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const written: string[] = [];
  const queue = createRequestQueue({ maxPendingRequests: 4, maxPendingBytes: 128, maxInFlightRequests: 2 }, async line => { written.push(line); if (line === 'first') await gate; }, () => {});
  const first = queue.enqueue(1, 'first', 'inspect', 0); const second = queue.enqueue(2, 'second', 'inspect', 0);
  queue.settle(1, null); await turn(); expect(written).toEqual(['first']); release(); await turn(); expect(written).toEqual(['first', 'second']);
  queue.settle(2, null); await Promise.all([first, second]);
});

it('rejects responses for requests that have never reached the pipe', async () => {
  const queue = createRequestQueue({ maxPendingRequests: 2, maxPendingBytes: 128, maxInFlightRequests: 1 }, async () => {}, () => {});
  const first = rejected(queue.enqueue(1, 'first', 'inspect', 0)); const second = rejected(queue.enqueue(2, 'second', 'inspect', 0));
  expect(() => queue.settle(2, null)).toThrow('Unknown desktop host response'); queue.fail(new Error('invalid response')); await Promise.all([first, second]);
});

it('expires an unsent request without retiring the connection or consuming its capacity', async () => {
  const written: string[] = []; const failures: Error[] = [];
  const queue = createRequestQueue({ maxPendingRequests: 2, maxPendingBytes: 128, maxInFlightRequests: 1 }, async line => { written.push(line); }, error => { failures.push(error); });
  const first = queue.enqueue(1, 'first', 'inspect', 0); const second = queue.enqueue(2, 'second', 'inspect', 20);
  expect((await rejected(second)).message).toContain('before publication'); expect(failures).toEqual([]); expect(queue.size).toBe(1);
  const third = queue.enqueue(3, 'third', 'inspect', 0); queue.settle(1, null); await turn();
  expect(written).toEqual(['first', 'third']); queue.settle(3, null); await Promise.all([first, third]);
});

it('limits concurrent subprocess commands during a sustained burst and remains usable afterward', async () => {
  const script = `import {createInterface} from 'node:readline';let active=0;let maximum=0;
    console.log(JSON.stringify({type:'ready'}));
    for await(const line of createInterface({input:process.stdin})) {
      const request=JSON.parse(line);if(request.kind==='shutdown'){console.log(JSON.stringify({id:request.id,result:null}));break;}
      active++;maximum=Math.max(maximum,active);
      setTimeout(()=>{active--;console.log(JSON.stringify({id:request.id,result:{sequence:maximum,instances:[]}}));},30);
    }`;
  const host = createProcessHost({ executable: process.execPath, args: ['-e', `await import('data:text/javascript;base64,${Buffer.from(script).toString('base64')}');`],
    window: true, maxPendingRequests: 24, maxInFlightRequests: 2 });
  await host.ready;
  try {
    const snapshots = await Promise.all(Array.from({ length: 20 }, () => host.inspect()));
    expect(snapshots.every(snapshot => snapshot.sequence <= 2)).toBe(true); expect(snapshots.at(-1)!.sequence).toBe(2);
    expect((await host.inspect()).sequence).toBe(2);
  } finally { await host.close(); }
});

it('validates admission limits before creating a process', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    expect(() => requestLimits({ maxPendingRequests: value })).toThrow('positive safe integers');
    expect(() => createProcessHost({ executable: 'must-not-launch', maxPendingBytes: value })).toThrow('positive safe integers');
  }
});

it('retires publication after ambiguous acceptance and never calls commit again', async () => {
  const template: SceneTemplate = { id: 'ambiguous', nodes: [{ kind: 'element', tag: 'button', parent: null, text: '' }, { kind: 'text', parent: 0, text: '' }], slots: [{ node: 1, type: 'text' }], events: [{ node: 0, type: 'click' }] };
  let commits = 0; const app = createDesktopApplication({ async install() {}, async commit(transaction) {
    commits++; if (transaction.sequence === 2) throw new DesktopConnectionError('acceptance unknown'); return { sequence: transaction.sequence };
  } });
  const root = app.mount(() => { let value = 0; return mountScene(template, [{ slot: 0, sources: ['value'], read: () => value }], [sceneEvent(() => value++, ['value'])]); });
  await root.ready; expect((await rejected(root.dispatch(0))).message).toBe('acceptance unknown');
  expect((await rejected(root.flush())).message).toBe('acceptance unknown'); expect(commits).toBe(2);
  await rejected(app.dispose()); expect(commits).toBe(2);
});

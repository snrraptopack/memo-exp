import { expect, it } from 'bun:test';
import {
  createDesktopApplication,
  measureElement,
  mountScene,
  type DesktopHost,
  type SceneElement,
  type SceneInstance,
  type SceneMeasurement,
  type SceneTemplate,
} from '../src';
import { createPublicationQueue } from '../src/runtime/publication';
import { compileDesktopGraph } from '@memoized-dom/compiler/desktop';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSceneSemanticRuntime } from '../src/runtime/semantic';
import { createProcessHost } from '../src/bridge/process';

it('refuses headless process measurements without poisoning later scene publication', async () => {
  const executable = resolve(import.meta.dirname, '../rust/target/debug',
    process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host');
  const host = createProcessHost({ executable });
  const app = createDesktopApplication(host);
  let element!: SceneElement;
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(ref) { element = ref; } }],
    }));
    await owner.ready;
    const refused = await element.measure().then(() => undefined, error => error as Error);
    expect(refused?.message).toContain('window host');
    await owner.dispose();
    expect((await host.inspect()).instances).toHaveLength(0);
  } finally {
    await app.dispose();
    await host.close();
  }
});

it('waits for overlapping family publication without treating process latency as a cascade', async () => {
  const semantic = createSceneSemanticRuntime();
  const gate = deferred<void>();
  const first = {};
  const other = {};
  semantic.request(other, () => gate.promise);
  const flushing = semantic.flush(async () => {}, first);
  let completed = false;
  void flushing.then(() => { completed = true; });
  await Bun.sleep(10);
  expect(completed).toBe(false);
  gate.resolve();
  await flushing;
  semantic.dispose();
});

it('keeps an unrelated publication failure for its caller and a later application flush', async () => {
  const semantic = createSceneSemanticRuntime();
  const gate = deferred<void>();
  const failure = new Error('other family refused');
  const job = semantic.request({}, async () => { await gate.promise; throw failure; });
  const captured = job.promise.then(() => undefined, error => error);
  const flushing = semantic.flush(async () => {}, {});
  gate.resolve();
  await flushing;
  expect(await captured).toBe(failure);
  await expect(semantic.flush()).rejects.toThrow('other family refused');
  semantic.dispose();
});

it('measures an ordinary compiled assignment ref inside an async reactive handler', async () => {
  const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
  const graph = compileDesktopGraph(`
    import { measureElement } from ${JSON.stringify(runtimePath)};
    function Caption({children}) { return <span>{children}</span>; }
    export function App() {
      let label: HTMLElement | undefined;
      let width = 0;
      let fragments = 0;
      return <main>
        <p><Caption><strong ref={label}>Wrapped text</strong></Caption></p>
        <button onClick={async () => {
          if (!label) return;
          const measurement = await measureElement(label);
          width = Math.round(measurement.bounds?.width ?? 0);
          fragments = measurement.rects.length;
        }}>Measure</button>
        <p>Measured width: {width}; fragments: {fragments}</p>
      </main>;
    }
  `, { moduleId: 'measurement-handler.tsx', runtimePath });
  const { code } = graph.modules.get('measurement-handler.tsx')!;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {
    App(): SceneInstance;
  };
  const transactions: unknown[] = [];
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      transactions.push(transaction);
      await Bun.sleep(20);
      return { sequence: transaction.sequence };
    },
    async measure(handle, node) {
      await Bun.sleep(1);
      const rect = { x: 0, y: 0, width: 123.4, height: 20 };
      return { ...geometry({ handle, node }), rects: [rect], bounds: rect };
    },
  });
  try {
    const owner = app.mount(module.App);
    await owner.ready;
    await app.dispatchEvent({ type: 'event', handle: owner.handle, site: 0, payload: { type: 'click' } });
    await Bun.sleep(30);
    await app.flush();
    expect(transactions).toHaveLength(2);
    expect(JSON.stringify(transactions[1])).toContain('123');
  } finally {
    await app.dispose();
  }
});

const template: SceneTemplate = {
  id: 'measured-ref',
  nodes: [{ kind: 'element', tag: 'p', parent: null, text: '' }],
  slots: [],
  events: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function geometry(element: Pick<SceneElement, 'handle' | 'node'>): SceneMeasurement {
  return { handle: element.handle, node: element.node, sequence: 1, frame: 2, rects: [], bounds: null };
}

it('measures accepted callback refs through the same capability and rejects foreign objects', async () => {
  let element!: SceneElement;
  let reading!: Promise<SceneMeasurement>;
  const calls: string[] = [];
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      calls.push('accept');
      return { sequence: transaction.sequence };
    },
    async measure(handle, node) {
      calls.push('measure');
      return geometry({ handle, node });
    },
  });
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(ref) { element = ref; reading = measureElement(ref); } }],
    }));
    await owner.ready;
    expect(await reading).toEqual(geometry(element));
    expect(calls).toEqual(['accept', 'measure']);
    expect(await element.measure()).toEqual(await measureElement(element));
    await expect(measureElement({ ...element })).rejects.toThrow('native desktop element ref');
    await owner.dispose();
    await expect(element.measure()).rejects.toThrow('disconnected');
  } finally {
    await app.dispose();
  }
});

it('rejects a captured measurement when the owner retires while the native read is pending', async () => {
  let element!: SceneElement;
  const arrived = deferred<void>();
  const reply = deferred<SceneMeasurement>();
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) { return { sequence: transaction.sequence }; },
    async measure() {
      arrived.resolve();
      return reply.promise;
    },
  });
  try {
    const owner = app.mount(() => mountScene(template, [], [], {
      refs: [{ node: 0, value(ref) { element = ref; } }],
    }));
    await owner.ready;
    const reading = element.measure();
    // Capture the rejection before releasing the asynchronous native response.
    const rejected = reading.then(() => undefined, error => error as Error);
    await arrived.promise;
    const retirement = owner.dispose();
    expect(element.isConnected).toBe(false);
    reply.resolve(geometry(element));
    expect((await rejected)?.message).toContain('disconnected');
    await retirement;
  } finally {
    reply.resolve(geometry(element));
    await app.dispose();
  }
});

it('orders measurement after requested publications and keeps explicit read refusals retryable', async () => {
  const accepted = deferred<void>();
  const calls: string[] = [];
  let refusal = true;
  const host: DesktopHost = {
    async install() {},
    async commit(transaction) {
      calls.push('commit');
      await accepted.promise;
      return { sequence: transaction.sequence };
    },
    async measure(handle, node) {
      calls.push('measure');
      if (refusal) throw new Error('native read refusal');
      return geometry({ handle, node });
    },
  };
  const queue = createPublicationQueue(host);
  const handle = { id: 1, generation: 1 };
  const publication = queue.publish(() => ({
    operation: { kind: 'mount', handle, template: template.id, values: [] },
    accept() { calls.push('accepted'); },
    reject() { throw new Error('Unexpected write rejection'); },
  }));
  const reading = queue.measure(handle, 0);
  const rejected = reading.then(() => undefined, error => error as Error);
  await Bun.sleep(0);
  expect(calls).toEqual(['commit']);
  accepted.resolve();
  await publication;
  expect((await rejected)?.message).toBe('native read refusal');
  expect(calls).toEqual(['commit', 'accepted', 'measure']);
  refusal = false;
  expect(await queue.measure(handle, 0)).toEqual(geometry({ handle, node: 0 }));
});

it('requires an explicit host capability instead of fabricating headless bounds', async () => {
  const queue = createPublicationQueue({
    async install() {},
    async commit(transaction) { return { sequence: transaction.sequence }; },
  });
  await expect(queue.measure({ id: 1, generation: 1 }, 0)).rejects.toThrow('does not support');
});

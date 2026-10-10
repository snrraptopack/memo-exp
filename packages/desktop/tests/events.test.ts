import { expect, it } from 'bun:test';
import { createProcessHost } from '../src/bridge/process';
import {
  createDesktopApplication,
  mountScene,
  sceneEvent,
  type NativeSceneEvent,
  type SceneTemplate,
} from '../src';

it('multiplexes native events and window closure without consuming request responses', async () => {
  const script = `
    import { createInterface } from 'node:readline';
    console.log(JSON.stringify({type:'ready'}));
    for await (const line of createInterface({input:process.stdin})) {
      const request=JSON.parse(line);
      if(request.kind==='apply') console.log(JSON.stringify({type:'event',handle:{id:1,generation:1},site:0}));
      if(request.kind==='inspect') console.log(JSON.stringify({type:'closed'}));
      const result=request.kind==='apply'?{sequence:request.transaction.sequence}:request.kind==='inspect'?{sequence:0,instances:[]}:null;
      console.log(JSON.stringify({id:request.id,result}));
      if(request.kind==='shutdown') break;
    }
  `;
  const host = createProcessHost({
    executable: process.execPath,
    args: ['-e', script],
    window: true,
  });
  const events: NativeSceneEvent[] = [];
  const unsubscribe = host.onEvent((event) => {
    events.push(event);
  });
  try {
    await host.ready;
    expect(await host.commit({ sequence: 1, operations: [] })).toEqual({ sequence: 1 });
    expect(events).toEqual([{ type: 'event', handle: { id: 1, generation: 1 }, site: 0 }]);
    expect(await host.inspect()).toEqual({ sequence: 0, instances: [] });
    await host.windowClosed;
    unsubscribe();
    await host.commit({ sequence: 2, operations: [] });
    expect(events).toHaveLength(1);
  } finally {
    await host.close();
  }
});

it('routes native handles to the owning instance and rejects stale generations', async () => {
  const template: SceneTemplate = {
    id: 'event-owner',
    nodes: [
      { kind: 'element', tag: 'button', parent: null, text: '' },
      { kind: 'text', parent: 0, text: '' },
    ],
    slots: [{ node: 1, type: 'text' }],
    events: [{ node: 0, type: 'click' }],
  };
  const writes: string[] = [];
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      for (const operation of transaction.operations)
        if ('values' in operation) writes.push(...operation.values.map((write) => write.value));
      return { sequence: transaction.sequence };
    },
  });
  const owner = app.mount(() => {
    let count = 0;
    return mountScene(
      template,
      [{ slot: 0, sources: ['count'], read: () => count }],
      [sceneEvent(() => count++, ['count'])],
    );
  });
  await owner.ready;
  await expect(
    app.dispatch({ ...owner.handle, generation: owner.handle.generation + 1 }, 0),
  ).rejects.toThrow('retired owner');
  expect(writes).toEqual(['0']);
  await app.dispatch(owner.handle, 0);
  expect(writes).toEqual(['0', '1']);
  await owner.dispose();
  await expect(app.dispatch(owner.handle, 0)).rejects.toThrow('retired owner');
  await app.dispose();
});

it('acknowledges cancellation for a node event without a direct handler site', async () => {
  const script = `
    import { createInterface } from 'node:readline';
    let canceledDispatch = 0;
    console.log(JSON.stringify({ type: 'ready' }));
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      if (request.kind === 'apply') {
        console.log(JSON.stringify({
          type: 'event', handle: { id: 1, generation: 1 }, node: 2,
          dispatch: 7, payload: { type: 'keydown', key: 'Tab' }
        }));
      }
      if (request.kind === 'event_result' && request.prevented) {
        canceledDispatch = request.dispatch;
      }
      const result = request.kind === 'apply'
        ? { sequence: request.transaction.sequence }
        : request.kind === 'inspect'
          ? { sequence: canceledDispatch, instances: [] }
          : null;
      console.log(JSON.stringify({ id: request.id, result }));
      if (request.kind === 'shutdown') break;
    }
  `;
  const host = createProcessHost({
    executable: process.execPath,
    args: ['-e', script],
    window: true,
  });
  const events: NativeSceneEvent[] = [];
  host.onEvent((event) => events.push(event));
  try {
    await host.ready;
    await host.commit({ sequence: 1, operations: [] });
    expect(events).toHaveLength(1);
    expect(events[0]!.site).toBeUndefined();
    await host.acknowledgeEvent(events[0]!, true);
    expect(await host.inspect()).toEqual({ sequence: 7, instances: [] });
  } finally {
    await host.close();
  }
});

for (const fields of [{ site: 0, node: -1 }, { site: -1, node: 0 }, {}, { node: 0, dispatch: 0 }]) {
  it(`retires a malformed native event before invoking callbacks: ${JSON.stringify(fields)}`, async () => {
    const event = { type: 'event', handle: { id: 1, generation: 1 }, ...fields };
    const script = `
      import { createInterface } from 'node:readline';
      console.log(JSON.stringify({ type: 'ready' }));
      for await (const line of createInterface({ input: process.stdin })) {
        console.log(Buffer.from('${Buffer.from(JSON.stringify(event)).toString('base64')}', 'base64').toString());
        break;
      }
    `;
    const host = createProcessHost({
      executable: process.execPath,
      args: [
        '-e',
        `await import('data:text/javascript;base64,${Buffer.from(script).toString('base64')}');`,
      ],
      window: true,
    });
    let callbacks = 0;
    host.onEvent(() => callbacks++);
    try {
      await host.ready;
      // Settle subprocess I/O before entering Bun's assertion machinery.
      const error = await host.inspect().then(
        () => null,
        (error) => error as Error,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain('Invalid native');
      expect(callbacks).toBe(0);
    } finally {
      await host.close().catch(() => {});
    }
  });
}

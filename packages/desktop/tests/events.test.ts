import { expect, test } from 'bun:test';
import { PublicationClient } from '../src/host/client';
import { parseNativeEvent, type NativeEventPacket } from '../src/host/events';
import { dispatchNativeEvent } from '../src/runtime/dispatch';
import type { NativeView } from '../src/runtime/view';
import type { SourceReference } from '../src/host/protocol';
import { ManualTransport } from './fixtures/manual-transport';

const packet: NativeEventPacket = {
  kind: 'event', version: 1, dispatchId: 1, eventType: 'click',
  path: [0, 1].map(source => ({ owner: { id: 'App', generation: 1 }, source })),
  cancelable: true, bubbles: true, timestamp: 12, sceneSequence: 1,
};

test('event dispatch waits for complete initial acceptance and activation', async () => {
  const transport = new ManualTransport();
  let completeWrite!: () => void;
  transport.write = () => new Promise(resolve => { completeWrite = resolve; });
  const observed: string[] = [];
  const client = new PublicationClient(transport, {
    dispatch: () => { observed.push('dispatch'); return true; },
  });
  const accepted = client.publish({ operations: [] }).then(() => { observed.push('activated'); });
  transport.observer!.reply(packet);
  transport.accept(1);
  await Bun.sleep(0);
  expect(observed).toEqual([]);
  transport.write = undefined;
  completeWrite();
  await accepted;
  await Bun.sleep(0);
  expect(observed).toEqual(['activated', 'dispatch']);
  expect(JSON.parse(transport.sent[1]!)).toEqual({
    kind: 'dispatchResult', version: 1, dispatchId: 1, cancelled: true,
  });
  const next = client.publish({ operations: [] });
  expect(JSON.parse(transport.sent[2]!).sequence).toBe(2);
  transport.accept(2);
  await next;
  client.close();
});

test('duplicate or unaccepted future event identities terminate the connection', async () => {
  for (const future of [false, true]) {
    const transport = new ManualTransport();
    const client = new PublicationClient(transport, { dispatch: () => false });
    const accepted = client.publish({ operations: [] });
    transport.accept(1);
    await accepted;
    transport.observer!.reply(future ? { ...packet, sceneSequence: 3 } : packet);
    if (!future) transport.observer!.reply(packet);
    expect(client.isClosed).toBe(true);
  }
});

test('capture and bubble use one event identity; cancellation is synchronous', () => {
  const calls: string[] = [];
  const targets = [new EventTarget(), new EventTarget()] as const;
  let captured: Event | undefined;
  const view = {
    matchesSource: () => true,
    eventTarget: (source: SourceReference) => targets[source.source],
    dispatch(source: SourceReference, name: string, event: Event) {
      calls.push(`${source.source}:${name}:${event.eventPhase}`);
      captured = event;
      expect(event.target).toBe(targets[0]);
      expect(event.currentTarget).toBe(targets[source.source]!);
      if (source.source === 0 && name === 'onClick') event.preventDefault();
    },
  } as unknown as NativeView;
  expect(dispatchNativeEvent(view, packet, error => { throw error; })).toBe(true);
  expect(calls).toEqual(['1:onClickCapture:1', '0:onClickCapture:2', '0:onClick:2', '1:onClick:3']);
  expect(captured!.currentTarget).toBeNull();
  expect(captured!.eventPhase).toBe(0);

  calls.length = 0;
  expect(dispatchNativeEvent(view, { ...packet, cancelable: false }, error => { throw error; })).toBe(false);
});

test('late promise cancellation cannot change the already returned default decision', async () => {
  let captured!: Event;
  const view = {
    matchesSource: () => true,
    eventTarget: () => ({}),
    dispatch(_source: SourceReference, name: string, event: Event) {
      if (name !== 'onClick') return;
      captured = event;
      return Promise.resolve().then(() => event.preventDefault());
    },
  } as unknown as NativeView;
  expect(dispatchNativeEvent(view, packet, error => { throw error; })).toBe(false);
  await Bun.sleep(0);
  expect(captured.defaultPrevented).toBe(false);
});

test('malformed source addresses fail before dispatch', () => {
  expect(() => parseNativeEvent({ ...packet, path: [] })).toThrow();
  expect(() => parseNativeEvent({ ...packet, unexpected: true })).toThrow();
  expect(() => parseNativeEvent({ ...packet, sceneSequence: 0 })).toThrow();
});

test('synchronous controlled corrections accompany the decision without waiting for scene acceptance', async () => {
  const transport = new ManualTransport();
  const controls = [{ op: 'setValue' as const, target: packet.path[0]!, value: '', revision: 3, version: 1 }];
  const client = new PublicationClient(transport, { dispatch: () => ({ cancelled: true, controls }) });
  const mounted = client.publish({ operations: [] });
  transport.accept(1);
  await mounted;
  transport.observer!.reply(packet);
  await Bun.sleep(0);
  expect(JSON.parse(transport.sent[1]!)).toEqual({
    kind: 'dispatchResult', version: 1, dispatchId: 1, cancelled: true, controls,
  });
  client.close();
});

test('graphical startup is separate from publication and duplicate readiness is terminal', async () => {
  const transport = new ManualTransport();
  const client = new PublicationClient(transport, { requireReady: true });
  const acceptance = client.publish({ operations: [] });
  expect(transport.sent).toHaveLength(0);
  transport.observer!.reply({ kind: 'ready', version: 1 });
  await client.whenReady();
  expect(transport.sent).toHaveLength(1);
  transport.accept(1);
  await acceptance;
  transport.observer!.reply({ kind: 'ready', version: 1 });
  expect(client.isClosed).toBe(true);
});

test('startup failure rejects readiness and queued work without a publication write', async () => {
  const transport = new ManualTransport();
  const client = new PublicationClient(transport, { requireReady: true });
  const ready = client.whenReady().catch(error => error);
  const accepted = client.publish({ operations: [] }).catch(error => error);
  transport.deadline!();
  expect(await ready).toMatchObject({ code: 'startupTimedOut' });
  expect(await accepted).toMatchObject({ code: 'startupTimedOut' });
  expect(transport.sent).toHaveLength(0);
});

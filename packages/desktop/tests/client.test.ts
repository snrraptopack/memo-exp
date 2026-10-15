import { describe, expect, test } from 'bun:test';
import { PublicationClient } from '../src/host/client';
import { MAX_PACKET_BYTES, type Publication } from '../src/host/protocol';
import { ManualTransport as TestTransport } from './fixtures/manual-transport';

const empty: Publication = { operations: [] };

function observed(promise: Promise<unknown>): Promise<unknown> {
  // Observe rejection immediately; no captured promise assertions across a
  // later cancellation, and no unhandled-rejection window under Bun.
  return promise.then(value => value, error => error);
}

async function turn(): Promise<void> { await Promise.resolve(); }

describe('engine-independent publication client', () => {
  test('capacity notifications follow settlement and honor unsubscribe and terminal close', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport, { maxPending: 2 });
    const events: string[] = [];
    const removed = client.onCapacity(() => events.push('removed'));
    removed();
    client.onCapacity(() => events.push('capacity'));
    expect(client.hasCapacity).toBe(true);
    const first = client.publish(empty).then(() => { events.push('accepted'); });
    const second = observed(client.publish(empty));
    expect(client.hasCapacity).toBe(false);
    transport.accept(1);
    await first;
    await Bun.sleep(0);
    expect(events).toEqual(['accepted', 'capacity']);
    expect(client.hasCapacity).toBe(true);
    transport.refuse(2);
    expect(await second).toMatchObject({ name: 'PublicationRefusedError' });
    await Bun.sleep(0);
    expect(events).toEqual(['accepted', 'capacity', 'capacity']);

    const third = observed(client.publish(empty));
    transport.accept(2);
    client.close();
    await third;
    await Bun.sleep(0);
    expect(client.hasCapacity).toBe(false);
    expect(events).toHaveLength(3);
  });

  test('idle close notifies current and late owners once, honoring unsubscribe', () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const errors: Error[] = [];
    const unsubscribe = client.onClose(() => { throw new Error('Removed listener must not run'); });
    unsubscribe();
    client.onClose(error => errors.push(error));

    transport.observer!.failure(new Error('Host vanished while idle'));
    client.close();
    client.onClose(error => errors.push(error));

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ code: 'acceptanceUnknown' });
    expect(errors[1]).toBe(errors[0]);
    expect(transport.disposed).toBe(true);
  });

  test('throwing close observer cannot strand queued rejections or other owners', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const active = observed(client.publish(empty));
    const queued = observed(client.publish(empty));
    let notified = false;
    client.onClose(() => { throw new Error('Owner cleanup failed'); });
    client.onClose(() => { notified = true; });

    transport.observer!.failure(new Error('Host failed'));

    expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
    expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
    expect(notified).toBe(true);
    expect(client.isClosed).toBe(true);
  });

  test('serializes jobs and snapshots caller mutation before enqueue', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const first = client.publish(empty);
    const operations: Publication['operations'][number][] = [];
    const second = client.publish({ operations });
    operations.push({ op: 'retire', owner: { id: 'late', generation: 1 } });

    expect(transport.sent).toHaveLength(1);
    transport.accept(1);
    expect(await first).toEqual({ version: 1, status: 'accepted', sequence: 1 });
    expect(JSON.parse(transport.sent[1]!)).toEqual({ version: 1, sequence: 2, operations: [] });
    transport.accept(2);
    expect((await second).sequence).toBe(2);
    client.close();
  });

  test('refusal rejects dependent queued work and corrected retry reuses its sequence', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const first = observed(client.publish(empty));
    const dependent = observed(client.publish(empty));
    transport.observer!.reply({
      version: 1, status: 'refused', expectedSequence: 1, code: 'unknownTemplate', message: 'missing',
    });
    expect(await first).toMatchObject({ name: 'PublicationRefusedError', code: 'unknownTemplate' });
    expect(await dependent).toMatchObject({ code: 'predecessorRefused' });
    expect(transport.sent).toHaveLength(1);
    expect(client.isClosed).toBe(false);
    const corrected = client.publish(empty);
    expect(JSON.parse(transport.sent[1]!).sequence).toBe(1);
    transport.accept(1);
    expect((await corrected).sequence).toBe(1);
    client.close();
  });

  test('bounded pressure refuses locally without canceling admitted work', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport, { maxPending: 1 });
    const first = client.publish(empty);
    expect(await observed(client.publish(empty))).toMatchObject({ code: 'queueFull' });
    expect(transport.sent).toHaveLength(1);
    expect(client.isClosed).toBe(false);
    transport.accept(1);
    await first;
    client.close();
  });

  test('UTF-8 oversize and unserializable work refuse before I/O on a healthy connection', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const value = '界'.repeat(Math.ceil(MAX_PACKET_BYTES / 3));
    expect(await observed(client.publish({ operations: [{
      op: 'text', target: { owner: { id: 'App', generation: 1 }, source: 0 }, value,
    }] }))).toMatchObject({ code: 'packetTooLarge' });
    const circular = { operations: [], templates: [] } as unknown as Publication;
    Object.defineProperty(circular, 'templates', { get() { throw new Error('getter failed'); } });
    expect(await observed(client.publish(circular))).toMatchObject({ message: 'getter failed' });
    expect(transport.sent).toHaveLength(0);
    expect(client.isClosed).toBe(false);
    client.close();
  });

  test('reply cannot accept lifecycle until the corresponding write completes', async () => {
    const transport = new TestTransport();
    let finishWrite!: () => void;
    transport.write = () => new Promise(resolve => { finishWrite = resolve; });
    const client = new PublicationClient(transport);
    let accepted = false;
    const publication = client.publish(empty).then(() => { accepted = true; });
    transport.accept(1);
    await turn();
    expect(accepted).toBe(false);
    finishWrite();
    await publication;
    expect(accepted).toBe(true);
    client.close();
  });

  test('reply received before a later write failure never accepts or replays', async () => {
    const transport = new TestTransport();
    let rejectWrite!: (error: Error) => void;
    transport.write = () => new Promise((_resolve, reject) => { rejectWrite = reject; });
    const client = new PublicationClient(transport);
    const publication = observed(client.publish(empty));
    transport.accept(1);
    rejectWrite(new Error('flush lost'));
    expect(await publication).toMatchObject({ code: 'acceptanceUnknown' });
    expect(client.isClosed).toBe(true);
    expect(transport.disposed).toBe(true);
    expect(transport.sent).toHaveLength(1);
  });

  test('deadline fails active and queued jobs, and late replies cannot resurrect them', async () => {
    const transport = new TestTransport();
    const client = new PublicationClient(transport);
    const active = observed(client.publish(empty));
    const queued = observed(client.publish(empty));
    const lateObserver = transport.observer!;
    transport.deadline!();
    expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
    expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
    lateObserver.reply({ version: 1, status: 'accepted', sequence: 1 });
    expect(client.isClosed).toBe(true);
    expect(await observed(client.publish(empty))).toMatchObject({ code: 'acceptanceUnknown' });
    expect(transport.sent).toHaveLength(1);
  });

  for (const reply of [
    { version: 1, status: 'accepted', sequence: 2 },
    { version: 99, status: 'accepted', sequence: 1 },
    { version: 1, status: 'accepted', sequence: 1, extra: true },
    { version: 1, status: 'accepted', sequence: Number.MAX_SAFE_INTEGER + 1 },
    { version: 1, status: 'refused', expectedSequence: null, code: 'bad', message: '' },
    { version: 1, status: 'fatal', expectedSequence: 1, code: 'acceptanceUnknown', message: 'failed' },
  ]) {
    test('invalid or fatal replies terminate pending publication: ' + JSON.stringify(reply), async () => {
      const transport = new TestTransport();
      const client = new PublicationClient(transport);
      const result = observed(client.publish(empty));
      transport.observer!.reply(reply);
      expect(await result).toBeInstanceOf(Error);
      expect(client.isClosed).toBe(true);
      expect(transport.disposed).toBe(true);
    });
  }

  test('connection failure cancels all pending work and cleanup errors cannot strand jobs', async () => {
    const transport = new TestTransport();
    transport.dispose = () => { throw new Error('cleanup failed'); };
    const client = new PublicationClient(transport);
    const active = observed(client.publish(empty));
    const queued = observed(client.publish(empty));
    transport.observer!.failure(new Error('pipe lost'));
    expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
    expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
    expect(client.isClosed).toBe(true);
  });

  test('synchronous adapter failure while scheduling cannot send after close', async () => {
    const transport = new TestTransport();
    transport.scheduleDeadline = (_milliseconds, callback) => {
      callback();
      return () => {};
    };
    const client = new PublicationClient(transport);
    expect(await observed(client.publish(empty))).toMatchObject({ code: 'acceptanceUnknown' });
    expect(transport.sent).toHaveLength(0);
    expect(transport.disposed).toBe(true);
  });

  test('an old uncanceled timer cannot close a later publication', async () => {
    const transport = new TestTransport();
    const deadlines: (() => void)[] = [];
    transport.scheduleDeadline = (_milliseconds, callback) => {
      deadlines.push(callback);
      return () => { throw new Error('engine cancellation failed'); };
    };
    const client = new PublicationClient(transport);
    const first = client.publish(empty);
    transport.accept(1);
    await first;
    const second = client.publish(empty);
    deadlines[0]!();
    expect(client.isClosed).toBe(false);
    transport.accept(2);
    expect((await second).sequence).toBe(2);
    client.close();
  });

  test('a synchronously failed adapter remains closed and releases its observer', async () => {
    const transport = new TestTransport();
    transport.listen = observer => {
      observer.failure(new Error('connection already lost'));
      return () => { transport.observer = undefined; };
    };
    const client = new PublicationClient(transport);
    expect(await observed(client.publish(empty))).toMatchObject({ code: 'acceptanceUnknown' });
    expect(client.isClosed).toBe(true);
    expect(transport.sent).toHaveLength(0);
    expect(transport.disposed).toBe(true);
  });
});

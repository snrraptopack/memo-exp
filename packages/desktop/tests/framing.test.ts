import { expect, test } from 'bun:test';
import { FrameDecoder, encodeFrame } from '../src/host/framing';
import { MAX_PACKET_BYTES } from '../src/host/protocol';

test('split and adjacent UTF-8 reply frames parse without concatenation', () => {
  const replies: unknown[] = [];
  const decoder = new FrameDecoder(value => replies.push(value));
  const first = encodeFrame(JSON.stringify({ text: '界🙂\n' }));
  const second = encodeFrame(JSON.stringify({ sequence: 2 }));
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  for (const byte of joined) decoder.push(Uint8Array.of(byte));
  decoder.end();
  expect(replies).toEqual([{ text: '界🙂\n' }, { sequence: 2 }]);
});

test('invalid prefixes refuse before payload allocation and cannot resynchronize', () => {
  for (const length of [0, MAX_PACKET_BYTES + 1, 0xffff_ffff]) {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, length);
    const decoder = new FrameDecoder(() => { throw new Error('unexpected reply'); });
    expect(() => decoder.push(header)).toThrow('byte budget');
    expect(() => decoder.push(encodeFrame('{}'))).toThrow('closed');
  }
});

test('partial prefix, partial payload, invalid UTF-8 and malformed JSON are terminal', () => {
  for (const bytes of [
    Uint8Array.of(0),
    Uint8Array.of(0, 0, 0, 3, 123),
  ]) {
    const decoder = new FrameDecoder(() => {});
    decoder.push(bytes);
    expect(() => decoder.end()).toThrow('inside a frame');
  }
  for (const bytes of [
    Uint8Array.of(0, 0, 0, 1, 0xff),
    encodeFrame('{'),
  ]) {
    const decoder = new FrameDecoder(() => {});
    expect(() => decoder.push(bytes)).toThrow();
    expect(() => decoder.push(encodeFrame('{}'))).toThrow('closed');
  }
});

test('outbound framing enforces the byte cap including multibyte text', () => {
  expect(encodeFrame('x'.repeat(MAX_PACKET_BYTES)).length).toBe(MAX_PACKET_BYTES + 4);
  expect(() => encodeFrame('')).toThrow();
  expect(() => encodeFrame('x'.repeat(MAX_PACKET_BYTES + 1))).toThrow();
  expect(() => encodeFrame('界'.repeat(Math.ceil(MAX_PACKET_BYTES / 3)))).toThrow();
});

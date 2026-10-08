import { afterEach, expect, it } from 'bun:test';
import { mocked, spyOnAccessor, stubGlobal, unstubAllGlobals, waitFor } from '../test-support/helpers';
import { mock } from 'bun:test';

afterEach(unstubAllGlobals);

it('polls asynchronous assertions and returns the successful value', async () => {
  let attempts = 0;
  const value = await waitFor(async () => {
    expect(++attempts).toBeGreaterThan(2);
    return 'settled';
  }, { interval: 1 });
  expect(value).toBe('settled');
});

it('reports the last assertion error when polling expires', async () => {
  const failure = new Error('not ready');
  await expect(waitFor(() => { throw failure; }, { timeout: 5, interval: 1 })).rejects.toBe(failure);
});

it('restores an original global descriptor after multiple stubs', () => {
  const key = '__bunTestDescriptor';
  const descriptor = { configurable: true, enumerable: false, get: () => 'original' };
  Object.defineProperty(globalThis, key, descriptor);
  try {
    stubGlobal(key, 'first');
    stubGlobal(key, 'second');
    unstubAllGlobals();
    expect(Object.getOwnPropertyDescriptor(globalThis, key)).toEqual(descriptor);
  } finally { Reflect.deleteProperty(globalThis, key); }
});

it('removes globals that did not exist before stubbing', () => {
  const key = '__bunTestAbsent';
  stubGlobal(key, undefined);
  expect(Object.hasOwn(globalThis, key)).toBe(true);
  unstubAllGlobals();
  expect(Object.hasOwn(globalThis, key)).toBe(false);
});

it('types existing mocks without wrapping them', () => {
  const fn = mock((value: number) => value * 2);
  expect(mocked(fn)).toBe(fn);
  expect(mocked(fn)(3)).toBe(6);
  expect(fn).toHaveBeenCalledWith(3);
});

it('mocks and restores inherited getters without leaving an own property', () => {
  const prototype = { get value() { return 7; } };
  const target = Object.create(prototype) as typeof prototype;
  const getter = spyOnAccessor(target, 'value', 'get').mockReturnValue(9);
  expect(target.value).toBe(9);
  expect(getter).toHaveBeenCalledTimes(1);
  getter.mockRestore();
  expect(target.value).toBe(7);
  expect(Object.hasOwn(target, 'value')).toBe(false);
});

it('keeps the original setter after a one-shot failure', () => {
  let value = 1;
  const target = { get value() { return value; }, set value(next: number) { value = next; } };
  const failure = new Error('setter failed');
  spyOnAccessor(target, 'value', 'set').mockImplementationOnce(() => { throw failure; });
  expect(() => { target.value = 2; }).toThrow(failure);
  target.value = 3;
  expect(target.value).toBe(3);
});

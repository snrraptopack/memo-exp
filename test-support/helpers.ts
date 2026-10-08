import { afterEach, expect, mock, type Mock } from 'bun:test';

export type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Retry assertions until they pass; propagate the last failure on timeout. */
export async function waitFor<T>(assertion: () => T | Promise<T>, options: number | { timeout?: number; interval?: number } = {}): Promise<T> {
  const { timeout = 1_000, interval = 20 } = typeof options === 'number' ? { timeout: options } : options;
  const deadline = performance.now() + timeout;
  for (;;) {
    try { return await assertion(); } catch (error) {
      if (performance.now() >= deadline) throw error;
      await Bun.sleep(Math.min(interval, Math.max(0, deadline - performance.now())));
    }
  }
}

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

/** Preserve descriptors so repeated stubs restore the original host property. */
export function stubGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, enumerable: true, value });
}

export function unstubAllGlobals(): void {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originalGlobals.clear();
}

/** Type an existing Bun mock or spy without changing its implementation. */
export function mocked<T extends (...args: any[]) => any>(fn: Mock<T>): Mock<T>;
export function mocked<T extends (...args: any[]) => any>(fn: T): Mock<T>;
export function mocked<T extends (...args: any[]) => any>(fn: T): Mock<T> {
  return fn as unknown as Mock<T>;
}

export function expectCalledOnceWith<T extends (...args: any[]) => any>(fn: Mock<T>, ...args: Parameters<T>): void {
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith(...args);
}

const restoreAccessors = new Set<() => void>();
afterEach(() => {
  for (const restore of [...restoreAccessors].reverse()) restore();
});

export function spyOnAccessor<T extends object, K extends keyof T>(target: T, key: K, access: 'get'): Mock<() => T[K]>;
export function spyOnAccessor<T extends object, K extends keyof T>(target: T, key: K, access: 'set'): Mock<(value: T[K]) => void>;
export function spyOnAccessor(target: object, key: PropertyKey, access: 'get' | 'set'): Mock<(...args: any[]) => any> {
  const original = Object.getOwnPropertyDescriptor(target, key);
  let owner: object | null = target;
  let descriptor = original;
  while (!descriptor && (owner = Object.getPrototypeOf(owner))) descriptor = Object.getOwnPropertyDescriptor(owner, key);
  const implementation = descriptor?.[access];
  if (!implementation) throw new Error(`Property ${String(key)} has no ${access} accessor`);
  const spy = mock(function (this: object, ...args: any[]) { return Reflect.apply(implementation, this, args); });
  const restore = () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
    restoreAccessors.delete(restore);
  };
  const reset = spy.mockRestore.bind(spy);
  Object.defineProperty(spy, 'mockRestore', { configurable: true, value: () => { reset(); restore(); } });
  Object.defineProperty(target, key, { ...descriptor, configurable: true, [access]: spy });
  restoreAccessors.add(restore);
  return spy;
}

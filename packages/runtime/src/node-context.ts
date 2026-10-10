/** Shared Node/Bun context configuration, independent of a rendering host. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { setStorageFactory } from './async-storage';

let configured = false;

export function configureNodeContext(): void {
  if (configured) return;
  configured = true;
  setStorageFactory(<T>() => new AsyncLocalStorage<T>());
}

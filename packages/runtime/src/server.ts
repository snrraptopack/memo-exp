/**
 * Server runtime entry. The public surface matches the client runtime while
 * request/application context propagation uses the host AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { setStorageFactory } from './async-storage';

setStorageFactory(<T>() => new AsyncLocalStorage<T>());

export * from './index';
export { parseMarkup } from './markup-parse';
export type { MarkupChild, MarkupElement } from './markup-parse';

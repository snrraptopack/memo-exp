/**
 * Server runtime entry. The public surface matches the client runtime while
 * request/application context propagation uses the host AsyncLocalStorage.
 */
import { configureNodeContext } from './node-context';

configureNodeContext();

export * from './index';
export { parseMarkup } from './markup-parse';
export type { MarkupChild, MarkupElement } from './markup-parse';
export { initialBootstrapDescriptor, readInitialBootstrap } from './initial-delivery';
export type { InitialBootstrap } from './initial-delivery';

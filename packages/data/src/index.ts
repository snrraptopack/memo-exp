import {
  getActiveDataRuntime,
} from './active-runtime';
import type {
  ActionFunction,
  ActionOptions,
  FetchFunction,
  FetchOptions,
} from './types';

export { createDataRuntime } from './client';
export {
  getActiveDataRuntime,
  setActiveDataRuntime,
} from './active-runtime';

// Delegating facades: server rendering swaps the active runtime per request,
// so the public bindings must never capture the singleton implementation.
export const $fetch = ((
  target: string | URL | null,
  options?: FetchOptions,
) => getActiveDataRuntime().$fetch(target, options)) as FetchFunction;
export const $action = ((
  target: string | URL,
  options?: ActionOptions<never, never>,
) =>
  getActiveDataRuntime().$action(target, options)) as unknown as ActionFunction;
export function clearDataRuntime(): void {
  getActiveDataRuntime().clear();
}
export { RequestError } from './errors';

export type {
  Action,
  ActionCallOptions,
  ActionFunction,
  ActionMethod,
  ActionOptions,
  AppCacheOptions,
  AsyncStatus,
  DataRuntime,
  DataRuntimeOptions,
  FetchCache,
  FetchCollectionChanges,
  FetchFunction,
  FetchOptions,
  FetchResource,
  FetchResourceCore,
  InferSchemaOutput,
  OptimisticChange,
  Query,
  QueryPrimitive,
  QueryValue,
  RequestKey,
  RequestKeyPart,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
  ValidatedFetchOptions,
} from './types';
export type { RequestErrorKind, RequestErrorOptions } from './errors';

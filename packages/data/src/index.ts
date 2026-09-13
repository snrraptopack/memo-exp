import {
  getActiveDataRuntime,
} from './active-runtime';
import type {
  ActionFunction,
  ActionOptions,
  FetchOptions,
  ResolvedValue,
  TransparentFetchFunction,
} from './types';
import {
  Error,
  Group,
  Pending,
  trackResolvedValue,
} from './transparent';

export { createDataRuntime } from './client';
export {
  getActiveDataRuntime,
  setActiveDataRuntime,
  runWithDataRuntime,
} from './active-runtime';
// Delegating facades: server rendering swaps the active runtime per request,
// so the public bindings must never capture the singleton implementation.
export const $fetch = ((
  target: string | URL | null,
  options?: FetchOptions,
) => getActiveDataRuntime().$fetch(target, options)) as unknown as TransparentFetchFunction;
export const $track = (<T>(value: ResolvedValue<T> | PromiseLike<T>) =>
  trackResolvedValue(value)) as typeof trackResolvedValue;
export { Group, Pending, Error };
export const $action = ((
  target: string | URL,
  options?: ActionOptions<never, never>,
) =>
  getActiveDataRuntime().$action(target, options)) as unknown as ActionFunction;
export function clearDataRuntime(): void {
  getActiveDataRuntime().clear();
}
export { RequestError } from './errors';
export { UnresolvedDataReadError } from './transparent';

export type {
  Action,
  ActionFunction,
  ActionMethod,
  ActionOptions,
  ActionResult,
  AppCacheOptions,
  AsyncStatus,
  DataRuntime,
  DataRuntimeOptions,
  FetchCache,
  FetchBody,
  FetchCollectionChanges,
  FetchFunction,
  FetchMethod,
  FetchOptions,
  FetchResource,
  FetchResourceCore,
  GroupProps,
  InferSchemaOutput,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OptimisticChange,
  PendingProps,
  ErrorProps,
  ErrorPolicyComponentProps,
  Query,
  QueryPrimitive,
  QueryValue,
  RequestKey,
  RequestKeyPart,
  ResolvedValue,
  SerializedDataState,
  SerializedSourceError,
  SerializedSourceRecord,
  SerializedSourceSnapshot,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
  TrackedValue,
  TransparentFetchFunction,
  ValidatedFetchOptions,
} from './types';
export type { RequestErrorKind, RequestErrorOptions } from './errors';

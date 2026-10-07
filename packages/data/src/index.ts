import {
  getActiveDataRuntime as activeDataRuntime,
  setActiveDataRuntime as setActiveRuntime,
  runWithDataRuntime as withActiveRuntime,
} from './active-runtime';
import type {
  DataRuntime,
  FetchOptions,
  ResolvedValue,
  TransparentFetchFunction,
} from './types';
import {
  Group,
  trackResolvedValue,
} from './transparent';
import { $forms, isFormSource, trackForm } from './forms';
import { enableDataReads } from './read-resource';
import { exposeDataRuntime } from './client';
import { enableRequestEncoding } from './request-encoding';
import { installActiveDataRestoration } from './active-restoration';

installActiveDataRestoration();

export { createDataRuntime } from './client';
export const runWithDataRuntime: <T>(runtime: DataRuntime, fn: () => T) => T = withActiveRuntime;
export function getActiveDataRuntime(): DataRuntime {
  return exposeDataRuntime(activeDataRuntime());
}
export function setActiveDataRuntime(runtime: DataRuntime | null): DataRuntime {
  return exposeDataRuntime(setActiveRuntime(runtime));
}
// Delegating facades: server rendering swaps the active runtime per request,
// so the public bindings must never capture the singleton implementation.
export const $fetch = ((
  target: string | URL | null,
  options?: FetchOptions,
) => enableRequestEncoding(activeDataRuntime()).$fetch(target, options)) as unknown as TransparentFetchFunction;
export const $read = <T>(
  promise: PromiseLike<T>,
  replay?: () => PromiseLike<T>,
): ResolvedValue<Awaited<T>> =>
  enableDataReads(activeDataRuntime()).$read(promise, replay) as unknown as ResolvedValue<Awaited<T>>;
export { $forms };
export function $track<T>(value: import('./forms').FormSource<T>): import('./forms').FormTracker<T>;
export function $track<T>(value: import('./transparent-module').ModuleSourceRef): import('./types').TrackedValue<T>;
export function $track<T>(value: import('./types').FetchResource<T>): import('./types').TrackedValue<T>;
export function $track<T>(value: ResolvedValue<T>): import('./types').TrackedValue<T>;
export function $track<T>(value: ResolvedValue<T> | import('./types').FetchResource<T> | import('./transparent-module').ModuleSourceRef | import('./forms').FormSource<T>): import('./types').TrackedValue<T, import('./errors').RequestError> | import('./forms').FormTracker<T> {
  return isFormSource(value)
    ? trackForm(value)
    : trackResolvedValue(value as ResolvedValue<T>);
}
export { Group };
export function clearDataRuntime(): void {
  activeDataRuntime().clear();
}
export { RequestError } from './errors';
export { UnresolvedDataReadError } from './transparent';

export type {
  AppCacheOptions,
  AsyncStatus,
  DataRuntime,
  DataRuntimeOptions,
  FetchCache,
  FetchBody,
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
export type { FormError, FormSource, FormTracker, SchemaFormOptions } from './forms';

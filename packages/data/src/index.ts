import { createDataRuntime } from './client';

const defaultRuntime = createDataRuntime();

export const $fetch = defaultRuntime.$fetch;
export const $action = defaultRuntime.$action;
export { RequestError } from './errors';

export type {
  Action,
  ActionCallOptions,
  ActionFunction,
  ActionMethod,
  ActionOptions,
  AppCacheOptions,
  AsyncStatus,
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

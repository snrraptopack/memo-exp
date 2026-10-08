export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

export type QueryPrimitive = string | number | boolean | null;
export type QueryValue =
  | QueryPrimitive
  | undefined
  | readonly QueryPrimitive[];
export type Query = Readonly<Record<string, QueryValue>>;

export type FetchMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}
export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | readonly JsonValue[];

/**
 * Replayable request bodies accepted by a colorless fetch source.
 *
 * Text, URLSearchParams, JSON, and binary bodies use a bounded content
 * fingerprint for request identity. Blob bodies use object identity;
 * FormData string fields use content identity while Blob/File fields use
 * object identity. Consequently, separately created but equivalent opaque
 * bodies do not deduplicate unless they reuse the same Blob/File instances.
 */
export type FetchBody =
  | JsonValue
  | Blob
  | FormData
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView;

export type RequestKeyPart = string | number | boolean | null;
export type RequestKey = string | readonly RequestKeyPart[];

export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | StandardSchemaResult<TOutput>
      | Promise<StandardSchemaResult<TOutput>>;
    readonly types?: {
      readonly input: TInput;
      readonly output: TOutput;
    };
  };
}

export type StandardSchemaResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | {
      readonly issues: readonly StandardSchemaIssue[];
      readonly value?: undefined;
    };

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

export type InferSchemaOutput<TSchema extends StandardSchemaV1> =
  TSchema extends StandardSchemaV1<unknown, infer TOutput>
    ? TOutput
    : never;

export interface AppCacheOptions {
  readonly scope: 'app';
}

export type FetchCache = false | 'active' | AppCacheOptions;

export interface FetchOptions {
  /** HTTP method (GET by default). */
  readonly method?: FetchMethod;
  /**
   * Request body. JSON values are serialized and receive an application/json
   * content type unless one was provided. GET and HEAD requests reject bodies.
   */
  readonly body?: FetchBody;
  readonly query?: Query;
  readonly headers?: HeadersInit;
  readonly key?: RequestKey;
  readonly cache?: FetchCache;
  readonly signal?: AbortSignal;
}

export interface ValidatedFetchOptions<
  TSchema extends StandardSchemaV1,
> extends FetchOptions {
  readonly validate: TSchema;
}

export interface RefreshableResource {
  refresh(): Promise<unknown>;
}

/**
 * Compiler-preserved provenance for a transparently authored fetch value.
 *
 * This member is type-only: the data runtime still carries a FetchResource
 * internally and the compiler prevents that holder from escaping into
 * application reads. ResolvedValue<T> remains assignable to T.
 */
declare const resolvedValue: unique symbol;
export type ResolvedValue<T> = T extends null | undefined
  ? T
  : T & {
      readonly [resolvedValue]: T;
    };

/** Reactive request state exposed for authored conditional rendering. */
export interface TrackedValue<T, TError = import('./errors').RequestError> {
  /** Identity of the exact request execution currently represented. */
  readonly id: string;
  /** The fulfilled value, or undefined while no value is available. */
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly refreshing: boolean;
  readonly error: TError | null;
  /** Observe this execution's successful result exactly once. */
  onSuccess(callback: (data: T, requestId: string) => void): () => void;
  /** Observe this execution's failure exactly once. */
  onError(
    callback: (
    error: TError,
      requestId: string,
    ) => void,
  ): () => void;
  /** Start a new request execution for this source. Awaiting is optional. */
  refresh(): Promise<T>;
  /** Stop the current request execution. */
  abort(): void;
  /** Type-only connection to the value whose request state is observed. */
  readonly valueType?: (value: T) => T;
}

export type DataPolicyComponent<TProps = object> = (
  props: TProps,
) => unknown;

export interface GroupProps {
  readonly suspend?: true;
  readonly pending?: DataPolicyComponent;
  readonly error?: DataPolicyComponent<ErrorPolicyComponentProps>;
  readonly children?: unknown;
}

export interface ErrorPolicyComponentProps {
  readonly error: import('@memoized-dom/runtime').PresentationError;
  readonly retry: () => Promise<unknown>;
}

export interface FetchResourceCore<T> extends RefreshableResource {
  readonly data: T | undefined;
  readonly error: import('./errors').RequestError | null;
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly refreshing: boolean;

  refresh(): Promise<T>;
  abort(): void;
  update(change: (current: T | undefined) => T): void;
  mutate(change: (current: T | undefined) => void): void;
}

export type FetchResource<T> = FetchResourceCore<T>;

export interface FetchFunction {
  <T = unknown>(
    target: string | URL | null,
    options?: FetchOptions,
  ): FetchResource<T>;

  <TSchema extends StandardSchemaV1>(
    target: string | URL | null,
    options: ValidatedFetchOptions<TSchema>,
  ): FetchResource<InferSchemaOutput<TSchema>>;
}

/** Public colorless fetch surface used by compiler-authored application code. */
export interface TransparentFetchFunction {
  <T = unknown>(
    target: string | URL | null,
    options?: FetchOptions,
  ): ResolvedValue<T>;

  <TSchema extends StandardSchemaV1>(
    target: string | URL | null,
    options: ValidatedFetchOptions<TSchema>,
  ): ResolvedValue<InferSchemaOutput<TSchema>>;
}

export interface DataRuntimeOptions {
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly baseURL?: string | URL;
}

export interface DataRuntime {
  readonly $fetch: FetchFunction;
  readonly $read: <T>(promise: PromiseLike<T>, replay?: () => PromiseLike<T>) => FetchResource<T>;

  /** Abort active work, detach live reads, and empty retained request data. */
  clear(): void;

  /**
   * Serialize materialized source snapshots for server→client transfer
   * (RFC §16.6). Only JSON-safe payloads transfer; non-serializable
   * sources are omitted.
   */
  /**
   * Await all currently active in-flight requests until quiescence.
   * Returns true if all settled, or false if timeout elapsed.
   */
  settle(timeoutMs?: number): Promise<boolean>;

  serializeState(): SerializedDataState;

  restoreState(state: SerializedDataState): void;
}

/** Sanitized error shape — cause/data/issues never transfer (RFC §16.6.5). */
export interface SerializedSourceError {
  readonly kind: string;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly message: string;
}

export type SerializedSourceSnapshot =
  | {
      readonly status: 'success';
      readonly data: unknown;
      /** Committed payload plus a revalidate intent, never an in-flight promise. */
      readonly revalidate: boolean;
    }
  | { readonly status: 'error'; readonly error: SerializedSourceError }
  | {
      readonly status: 'pending';
      /** The streaming response delivers the outcome later; do not refetch it. */
      readonly streamed?: boolean;
    };

export interface SerializedSourceRecord {
  /** Stable public transfer identity. */
  readonly sourceId: string;
  /** Provider, payload format, and schema contract. */
  readonly contractId: string;
  /** Safe digest used to reject a different evaluated request. */
  readonly requestFingerprint: string;
  readonly snapshot: SerializedSourceSnapshot;
}

export interface SerializedDataStateV1 {
  readonly formatVersion: 1;
  readonly sources: readonly SerializedSourceRecord[];
}

export type SerializedDataState = SerializedDataStateV1;

export interface ResourceSnapshot<T> {
  readonly data: T | undefined;
  readonly error: import('./errors').RequestError | null;
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly refreshing: boolean;
}

export type ResourceListener<T> = (
  snapshot: ResourceSnapshot<T>,
) => void;

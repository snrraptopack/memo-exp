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

export type ActionMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ActionOptions<TResult, TInput> {
  readonly method?: ActionMethod;
  readonly query?: Query;
  readonly headers?: HeadersInit;
  readonly validate?: StandardSchemaV1<unknown, TResult>;
  readonly onSuccess?: (
    result: TResult,
    input: TInput,
  ) => void | Promise<void>;
  readonly onError?: (
    error: import('./errors').RequestError,
    input: TInput,
  ) => void | Promise<void>;
}

/** Opaque change produced by a resource and consumed by an action call. */
export interface OptimisticChange<TResult = unknown> {
  readonly kind: 'memoized-dom.optimistic-change';

  /** Invariant phantom type connecting the change to an action result. */
  readonly resultType?: (result: TResult) => TResult;
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
export interface TrackedValue<T> {
  /** Identity of the exact request execution currently represented. */
  readonly id: string;
  /** The fulfilled value, or undefined while no value is available. */
  readonly value: T | undefined;
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly refreshing: boolean;
  readonly error: import('./errors').RequestError | null;
  /** Observe this execution's successful result exactly once. */
  onSuccess(callback: (data: T, requestId: string) => void): () => void;
  /** Observe this execution's failure exactly once. */
  onError(
    callback: (
      error: import('./errors').RequestError,
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
  readonly children?: unknown;
}

export interface PendingProps {
  readonly component: DataPolicyComponent;
}

export interface ErrorPolicyComponentProps {
  readonly error: import('./errors').RequestError;
  readonly retry: () => Promise<unknown>;
}

export interface ErrorProps {
  readonly component: DataPolicyComponent<ErrorPolicyComponentProps>;
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

export interface FetchCollectionChanges<TItem> {
  append(temporary: TItem): OptimisticChange<TItem>;
  replace(current: TItem, temporary: TItem): OptimisticChange<TItem>;
  remove<TResult = unknown>(current: TItem): OptimisticChange<TResult>;
}

export type FetchResource<T> = FetchResourceCore<T> &
  (T extends TItemArray<infer TItem>
    ? FetchCollectionChanges<TItem>
    : object);

type TItemArray<TItem> = TItem[];

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

/** One independently tracked invocation returned immediately by an action. */
export interface ActionResult<TResult> {
  readonly id: string;
  readonly state: AsyncStatus;
  readonly data: TResult | undefined;
  readonly error: import('./errors').RequestError | null;
}

type ActionCall<TResult, TInput> = [TInput] extends [void]
  ? (input?: TInput) => ActionResult<TResult>
  : (input: TInput) => ActionResult<TResult>;

export type Action<TResult, TInput = void> = ActionCall<TResult, TInput>;

export interface ActionFunction {
  <TResult, TInput = void>(
    target: string | URL,
    options?: ActionOptions<TResult, TInput>,
  ): Action<TResult, TInput>;
}

export interface DataRuntimeOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseURL?: string | URL;
}

export interface DataRuntime {
  readonly $fetch: FetchFunction;
  readonly $action: ActionFunction;

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
  | { readonly status: 'pending' };

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

export interface ActionResultSnapshot<T> {
  readonly id: string;
  readonly data: T | undefined;
  readonly error: import('./errors').RequestError | null;
  readonly state: AsyncStatus;
}

export type ActionResultListener<T> = (
  snapshot: ActionResultSnapshot<T>,
) => void;

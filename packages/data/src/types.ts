export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

export type QueryPrimitive = string | number | boolean | null;
export type QueryValue =
  | QueryPrimitive
  | undefined
  | readonly QueryPrimitive[];
export type Query = Readonly<Record<string, QueryValue>>;

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
export type ResolvedValue<T> = T & {
  readonly [resolvedValue]: T;
};

export interface ResolvedOperations<T> {
  refresh(): Promise<T>;
  abort(): void;
  update(change: (current: T | undefined) => T): void;
  mutate(change: (current: T | undefined) => void): void;
}

export interface ResolvedCollectionOperations<TItem> {
  append(temporary: TItem): OptimisticChange<TItem>;
  replace(current: TItem, temporary: TItem): OptimisticChange<TItem>;
  remove<TResult = unknown>(current: TItem): OptimisticChange<TResult>;
}

export type OperationsFor<T> = ResolvedOperations<T> &
  (T extends Array<infer TItem>
    ? ResolvedCollectionOperations<TItem>
    : object);

/** Reactive request state exposed for authored conditional rendering. */
export interface TrackedValue<T> {
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly refreshing: boolean;
  readonly error: import('./errors').RequestError | null;
  /** Type-only connection to the value whose request state is observed. */
  readonly valueType?: (value: T) => T;
}

export type DataPolicyComponent<TProps = object> = (
  props: TProps,
) => unknown;

export interface GroupProps {
  readonly data: ResolvedValue<unknown> | Readonly<Record<string, ResolvedValue<unknown>>>;
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

export interface ActionCallOptions<TResult> {
  readonly optimistic?: OptimisticChange<TResult>;
  readonly refresh?: readonly (
    | RefreshableResource
    | ResolvedValue<unknown>
  )[];
  readonly signal?: AbortSignal;
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

interface ActionState<TResult> {
  readonly data: TResult | undefined;
  readonly error: import('./errors').RequestError | null;
  readonly status: AsyncStatus;
  readonly pending: boolean;
  abort(): void;
  reset(): void;
}

type ActionCall<TResult, TInput> = [TInput] extends [void]
  ? (
      input?: TInput,
      options?: ActionCallOptions<TResult>,
    ) => Promise<TResult>
  : (
      input: TInput,
      options?: ActionCallOptions<TResult>,
    ) => Promise<TResult>;

export type Action<TResult, TInput = void> = ActionState<TResult> &
  ActionCall<TResult, TInput>;

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
}

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

export interface ActionSnapshot<T> {
  readonly data: T | undefined;
  readonly error: import('./errors').RequestError | null;
  readonly status: AsyncStatus;
  readonly pending: boolean;
}

export type ActionListener<T> = (snapshot: ActionSnapshot<T>) => void;

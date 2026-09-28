import { $read, $track } from '@memoized-dom/data';
import type { FetchResource, RequestError, ResolvedValue } from '@memoized-dom/data';
import { disposeFetchResource, isFetchResource } from '@memoized-dom/data/internal';

type OperationResult =
  | PromiseLike<unknown>
  | FetchResource<unknown>
  | ResolvedValue<unknown>;

type SettledResult<T> =
  T extends PromiseLike<infer U> ? Awaited<U> :
  T extends FetchResource<infer U> ? U :
  T extends ResolvedValue<infer U> ? U :
  never;

export interface OptimisticOptions<TPayload, TResult extends OperationResult> {
  /** Start one new request for each call. Its result is returned unchanged. */
  readonly action: (payload: TPayload) => TResult;
  /** Make the immediate change and return its operation-specific rollback. */
  readonly apply: (
    payload: TPayload,
    operationId: string,
  ) => (error: RequestError) => void;
  /** Replace the temporary change with this operation's server result. */
  readonly reconcile?: (
    saved: SettledResult<TResult>,
    payload: TPayload,
    operationId: string,
  ) => void;
}

const seenOperations = new WeakMap<object, string>();
const seenPromises = new WeakSet<object>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Apply an immediate change and undo only that call if its request fails. */
export function optimistic<TPayload, TResult extends OperationResult>(
  options: OptimisticOptions<TPayload, TResult>,
): (payload: TPayload) => TResult {
  return (payload) => {
    const result = options.action(payload);
    const existingSource = isFetchResource(result);
    if (!existingSource && !isPromiseLike(result)) {
      throw new TypeError('optimistic action must return a trackable source or promise');
    }
    if (!existingSource) {
      if (seenPromises.has(result)) {
        throw new TypeError('optimistic action must start a new operation for each call');
      }
      seenPromises.add(result);
    }

    // Transparent values are FetchResource holders at runtime; their authored
    // ResolvedValue type intentionally hides those methods from application code.
    const source: FetchResource<unknown> = existingSource
      ? result
      : $read(result) as unknown as FetchResource<unknown>;
    const tracker = $track(source);
    const operationId = tracker.id;
    const previousId = seenOperations.get(source);
    if (previousId === operationId) {
      if (!existingSource) disposeFetchResource(source);
      throw new TypeError('optimistic action must start a new operation for each call');
    }
    seenOperations.set(source, operationId);

    let rollback: (error: RequestError) => void;
    try {
      rollback = options.apply(payload, operationId);
      if (typeof rollback !== 'function') {
        throw new TypeError('optimistic apply must return a rollback function');
      }
    } catch (error) {
      if (!existingSource) disposeFetchResource(source);
      throw error;
    }

    let finished = false;
    let stopSuccess = () => {};
    let stopError = () => {};
    const finish = (error?: RequestError): void => {
      if (finished) return;
      finished = true;
      stopSuccess();
      stopError();
      if (!existingSource) disposeFetchResource(source);
      if (error !== undefined) rollback(error);
    };

    stopSuccess = tracker.onSuccess(saved => {
      if (finished) return;
      finish();
      options.reconcile?.(saved as SettledResult<TResult>, payload, operationId);
    });
    if (!finished) stopError = tracker.onError(error => finish(error));
    return result;
  };
}

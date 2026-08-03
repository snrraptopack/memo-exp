import { isAbortError, toRequestError } from './errors';
import { optimisticHandlers } from './optimistic';
import {
  decodeResponse,
  encodeActionBody,
  resolveRequestURL,
} from './request';
import type { FetchEnvironment } from './resource';
import type {
  Action,
  ActionCallOptions,
  ActionListener,
  ActionOptions,
  ActionSnapshot,
} from './types';

interface MutableActionSnapshot<T> {
  data: T | undefined;
  error: import('./errors').RequestError | null;
  status: ActionSnapshot<T>['status'];
  pending: boolean;
}

interface ActionController<T> {
  readonly listeners: Set<ActionListener<T>>;
  readonly controllers: Set<AbortController>;
  snapshot: MutableActionSnapshot<T>;
  sequence: number;
  active: number;
  disposed: boolean;
  notify(): void;
  abort(): void;
  reset(): void;
}

const actionControllers = new WeakMap<object, ActionController<unknown>>();

function snapshot<T>(
  value: MutableActionSnapshot<T>,
): ActionSnapshot<T> {
  return { ...value };
}

function createController<T>(): ActionController<T> {
  const controller: ActionController<T> = {
    listeners: new Set(),
    controllers: new Set(),
    snapshot: {
      data: undefined,
      error: null,
      status: 'idle',
      pending: false,
    },
    sequence: 0,
    active: 0,
    disposed: false,
    notify() {
      const value = snapshot(this.snapshot);
      for (const listener of this.listeners) listener(value);
    },
    abort() {
      for (const active of [...this.controllers]) active.abort();
      this.snapshot.error = null;
      this.snapshot.status = 'idle';
      this.notify();
    },
    reset() {
      this.abort();
      this.snapshot = {
        data: undefined,
        error: null,
        status: 'idle',
        pending: this.active !== 0,
      };
      this.notify();
    },
  };
  return controller;
}

function linkSignal(
  source: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (source === undefined) return () => {};
  const abort = () => controller.abort();
  if (source.aborted) abort();
  else source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

export function createAction<TResult, TInput>(
  environment: FetchEnvironment,
  target: string | URL,
  options: ActionOptions<TResult, TInput>,
): Action<TResult, TInput> {
  const controller = createController<TResult>();
  const url = resolveRequestURL(target, options.query, environment.baseURL);

  const invoke = async (
    input: TInput,
    callOptions: ActionCallOptions<TResult> = {},
  ): Promise<TResult> => {
    if (controller.disposed) {
      throw new Error('Cannot invoke a disposed action');
    }

    const change = callOptions.optimistic === undefined
      ? undefined
      : optimisticHandlers(callOptions.optimistic);

    const sequence = ++controller.sequence;
    const abortController = new AbortController();
    const unlink = linkSignal(callOptions.signal, abortController);
    controller.controllers.add(abortController);
    controller.active++;
    controller.snapshot.error = null;
    controller.snapshot.status = 'pending';
    controller.snapshot.pending = true;
    controller.notify();

    let operationSucceeded = false;

    try {
      const headers = new Headers(options.headers);
      const body = encodeActionBody(input, headers);
      const response = await environment.fetch()(url, {
        method: options.method ?? 'POST',
        headers,
        body,
        signal: abortController.signal,
      });
      const result = await decodeResponse(response, options.validate) as TResult;
      operationSucceeded = true;
      change?.commit(result);

      if (sequence === controller.sequence) {
        controller.snapshot.data = result;
        controller.snapshot.error = null;
        controller.snapshot.status = 'success';
        controller.notify();
      }

      await options.onSuccess?.(result, input);

      for (const resource of callOptions.refresh ?? []) {
        resource.refresh().catch(() => {});
      }
      return result;
    } catch (cause) {
      if (!operationSucceeded) change?.rollback();

      if (isAbortError(cause)) {
        if (sequence === controller.sequence) {
          controller.snapshot.error = null;
          controller.snapshot.status = 'idle';
          controller.notify();
        }
        throw cause;
      }

      if (operationSucceeded) throw cause;
      const error = toRequestError(cause);
      if (sequence === controller.sequence) {
        controller.snapshot.error = error;
        controller.snapshot.status = 'error';
        controller.notify();
      }
      try {
        await options.onError?.(error, input);
      } catch {
        // The request error remains the action failure. Error callbacks do not
        // replace transport failures with unrelated callback failures.
      }
      throw error;
    } finally {
      unlink();
      controller.controllers.delete(abortController);
      controller.active--;
      controller.snapshot.pending = controller.active !== 0;
      controller.notify();
    }
  };

  const action = invoke as Action<TResult, TInput>;
  Object.defineProperties(action, {
    data: { get: () => controller.snapshot.data },
    error: { get: () => controller.snapshot.error },
    status: { get: () => controller.snapshot.status },
    pending: { get: () => controller.snapshot.pending },
  });
  action.abort = () => controller.abort();
  action.reset = () => controller.reset();

  actionControllers.set(
    action,
    controller as ActionController<unknown>,
  );
  return action;
}

function getController<T>(action: Action<T, unknown>): ActionController<T> {
  const controller = actionControllers.get(action);
  if (controller === undefined) {
    throw new TypeError('Value is not an action from @memoized-dom/data');
  }
  return controller as ActionController<T>;
}

export function subscribeAction<T, TInput>(
  action: Action<T, TInput>,
  listener: ActionListener<T>,
): () => void {
  const controller = getController(action as Action<T, unknown>);
  controller.listeners.add(listener);
  listener(snapshot(controller.snapshot));
  return () => controller.listeners.delete(listener);
}

export function actionSnapshot<T, TInput>(
  action: Action<T, TInput>,
): ActionSnapshot<T> {
  return snapshot(
    getController(action as Action<T, unknown>).snapshot,
  );
}

export function disposeAction<T, TInput>(
  action: Action<T, TInput>,
): void {
  const controller = getController(action as Action<T, unknown>);
  if (controller.disposed) return;
  controller.disposed = true;
  controller.abort();
  controller.listeners.clear();
}

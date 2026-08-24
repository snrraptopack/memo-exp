import { isAbortError, toRequestError } from './errors';
import { SnapshotNotifier } from './notifications';
import { optimisticHandlers } from './optimistic';
import {
  abortable,
  abortReason,
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
  RefreshableResource,
} from './types';

interface MutableActionSnapshot<T> {
  data: T | undefined;
  error: import('./errors').RequestError | null;
  status: ActionSnapshot<T>['status'];
  pending: boolean;
}

interface ActionInvocation {
  readonly abortController: AbortController;
  readonly sequence: number;
  cancelled: boolean;
}

function snapshot<T>(value: MutableActionSnapshot<T>): ActionSnapshot<T> {
  return Object.freeze({ ...value });
}

class ActionController<T> {
  readonly invocations = new Set<ActionInvocation>();
  readonly notifier = new SnapshotNotifier(() => snapshot(this.snapshot));
  snapshot: MutableActionSnapshot<T> = {
    data: undefined,
    error: null,
    status: 'idle',
    pending: false,
  };
  sequence = 0;
  disposed = false;
  hasData = false;

  constructor(readonly store: ActionStore) {}

  begin(invocation: ActionInvocation): void {
    if (this.invocations.size === 0) {
      this.store.track(this as unknown as ActionController<unknown>);
    }
    this.invocations.add(invocation);
    this.snapshot.error = null;
    this.snapshot.status = 'pending';
    this.snapshot.pending = true;
    this.notifier.notify();
  }

  isVisible(invocation: ActionInvocation): boolean {
    return !invocation.cancelled && invocation.sequence === this.sequence;
  }

  succeed(invocation: ActionInvocation, result: T): void {
    if (!this.isVisible(invocation)) return;
    this.snapshot.data = result;
    this.snapshot.error = null;
    this.snapshot.status = 'success';
    this.hasData = true;
    this.notifier.notify();
  }

  fail(
    invocation: ActionInvocation,
    error: import('./errors').RequestError,
  ): void {
    if (!this.isVisible(invocation)) return;
    this.snapshot.error = error;
    this.snapshot.status = 'error';
    this.notifier.notify();
  }

  cancelInvocation(invocation: ActionInvocation, reason?: unknown): void {
    if (invocation.cancelled) return;
    const visible = this.isVisible(invocation);
    invocation.cancelled = true;
    invocation.abortController.abort(reason);
    if (visible) {
      this.sequence++;
      this.snapshot.error = null;
      this.snapshot.status = this.hasData ? 'success' : 'idle';
    }
    const pending = [...this.invocations].some(item => !item.cancelled);
    if (visible || this.snapshot.pending !== pending) {
      this.snapshot.pending = pending;
      this.notifier.notify();
    }
  }

  finish(invocation: ActionInvocation): void {
    this.invocations.delete(invocation);
    if (this.invocations.size === 0) {
      this.store.untrack(this as unknown as ActionController<unknown>);
    }
    const pending = [...this.invocations].some(item => !item.cancelled);
    if (this.snapshot.pending !== pending) {
      this.snapshot.pending = pending;
      this.notifier.notify();
    }
  }

  abort(reset: boolean): void {
    this.sequence++;
    for (const invocation of this.invocations) {
      invocation.cancelled = true;
      invocation.abortController.abort();
    }
    this.snapshot.error = null;
    this.snapshot.pending = false;
    if (reset) {
      this.snapshot.data = undefined;
      this.snapshot.status = 'idle';
      this.hasData = false;
    } else {
      this.snapshot.status = this.hasData ? 'success' : 'idle';
    }
    this.notifier.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.abort(true);
    this.disposed = true;
    this.notifier.clear();
    this.store.untrack(this as unknown as ActionController<unknown>);
  }
}

export class ActionStore {
  private readonly active = new Set<ActionController<unknown>>();

  track(controller: ActionController<unknown>): void {
    this.active.add(controller);
  }

  untrack(controller: ActionController<unknown>): void {
    this.active.delete(controller);
  }

  clear(): void {
    for (const controller of [...this.active]) controller.abort(true);
  }
}

const actionControllers = new WeakMap<object, ActionController<unknown>>();

function linkSignal(
  source: AbortSignal | undefined,
  abort: () => void,
): () => void {
  if (source === undefined) return () => {};
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}

export function createAction<TResult, TInput>(
  environment: FetchEnvironment,
  store: ActionStore,
  target: string | URL,
  options: ActionOptions<TResult, TInput>,
): Action<TResult, TInput> {
  const controller = new ActionController<TResult>(store);
  const url = resolveRequestURL(target, options.query, environment.baseURL);

  const invoke = async (
    input: TInput,
    callOptions: ActionCallOptions<TResult> = {},
  ): Promise<TResult> => {
    const change = callOptions.optimistic === undefined
      ? undefined
      : optimisticHandlers(callOptions.optimistic);
    if (controller.disposed) {
      change?.rollback();
      throw new Error('Cannot invoke a disposed action');
    }
    if (callOptions.signal?.aborted) {
      change?.rollback();
      throw abortReason(callOptions.signal);
    }

    const invocation: ActionInvocation = {
      sequence: ++controller.sequence,
      abortController: new AbortController(),
      cancelled: false,
    };
    controller.begin(invocation);
    const unlink = linkSignal(
      callOptions.signal,
      () => controller.cancelInvocation(
        invocation,
        abortReason(callOptions.signal!),
      ),
    );
    let operationSucceeded = false;

    try {
      const headers = new Headers(options.headers);
      const body = encodeActionBody(input, headers);
      const response = await abortable(
        () => environment.fetch()(url, {
          method: options.method ?? 'POST',
          headers,
          body,
          signal: invocation.abortController.signal,
        }),
        invocation.abortController.signal,
      );
      const result = await abortable(
        () => decodeResponse(response, options.validate) as Promise<TResult>,
        invocation.abortController.signal,
      );
      if (invocation.cancelled) {
        throw abortReason(invocation.abortController.signal);
      }
      change?.commit(result);
      operationSucceeded = true;
      controller.succeed(invocation, result);

      await options.onSuccess?.(result, input);
      if (invocation.cancelled) {
        throw abortReason(invocation.abortController.signal);
      }
      for (const resource of callOptions.refresh ?? []) {
        // Transparent authored values are FetchResource holders in generated
        // code; the public type intentionally hides those methods.
        (resource as RefreshableResource).refresh().catch(() => {});
      }
      return result;
    } catch (cause) {
      if (!operationSucceeded) change?.rollback();

      if (invocation.cancelled || isAbortError(cause)) {
        controller.cancelInvocation(invocation);
        throw cause;
      }

      if (operationSucceeded) throw cause;
      const error = toRequestError(cause);
      controller.fail(invocation, error);
      try {
        await options.onError?.(error, input);
      } catch {
        // The request error remains the action failure. Error callbacks do not
        // replace transport failures with unrelated callback failures.
      }
      throw error;
    } finally {
      unlink();
      controller.finish(invocation);
    }
  };

  const action = invoke as Action<TResult, TInput>;
  Object.defineProperties(action, {
    data: { get: () => controller.snapshot.data },
    error: { get: () => controller.snapshot.error },
    status: { get: () => controller.snapshot.status },
    pending: { get: () => controller.snapshot.pending },
  });
  action.abort = () => {
    if (controller.disposed) throw new Error('Cannot abort a disposed action');
    controller.abort(false);
  };
  action.reset = () => {
    if (controller.disposed) throw new Error('Cannot reset a disposed action');
    controller.abort(true);
  };

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
  if (controller.disposed) throw new Error('Cannot subscribe to a disposed action');
  return controller.notifier.subscribe(listener);
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
  getController(action as Action<T, unknown>).dispose();
}

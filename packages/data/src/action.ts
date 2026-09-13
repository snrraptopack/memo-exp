import { isAbortError, toRequestError } from './errors';
import { SnapshotNotifier } from './notifications';
import {
  abortable,
  decodeResponse,
  encodeRequestBody,
  resolveRequestURL,
} from './request';
import type { FetchEnvironment } from './resource';
import type {
  Action,
  ActionOptions,
  ActionResult,
  ActionResultListener,
  ActionResultSnapshot,
} from './types';

interface MutableActionResultSnapshot<T> {
  id: string;
  data: T | undefined;
  error: import('./errors').RequestError | null;
  state: ActionResultSnapshot<T>['state'];
}

function snapshot<T>(
  value: MutableActionResultSnapshot<T>,
): ActionResultSnapshot<T> {
  return Object.freeze({ ...value });
}

class ActionResultController<T> {
  readonly abortController = new AbortController();
  readonly notifier = new SnapshotNotifier(() => snapshot(this.snapshot));
  readonly snapshot: MutableActionResultSnapshot<T>;
  disposed = false;
  finished = false;

  constructor(
    readonly store: ActionStore,
    id: string,
  ) {
    this.snapshot = {
      id,
      data: undefined,
      error: null,
      state: 'idle',
    };
    store.track(this as unknown as ActionResultController<unknown>);
  }

  begin(): boolean {
    if (this.disposed || this.finished || this.abortController.signal.aborted) {
      this.finish();
      return false;
    }
    this.snapshot.error = null;
    this.snapshot.state = 'pending';
    this.notifier.notify();
    return true;
  }

  succeed(result: T): void {
    if (this.disposed || this.abortController.signal.aborted) return;
    this.snapshot.data = result;
    this.snapshot.error = null;
    this.snapshot.state = 'success';
    this.notifier.notify();
  }

  fail(error: import('./errors').RequestError): void {
    if (this.disposed || this.abortController.signal.aborted) return;
    this.snapshot.data = undefined;
    this.snapshot.error = error;
    this.snapshot.state = 'error';
    this.notifier.notify();
  }

  cancel(): void {
    if (this.finished) return;
    this.abortController.abort();
    this.snapshot.data = undefined;
    this.snapshot.error = null;
    this.snapshot.state = 'idle';
    this.notifier.notify();
    this.finish();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.store.untrack(this as unknown as ActionResultController<unknown>);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.notifier.clear();
  }
}

export class ActionStore {
  private readonly active = new Set<ActionResultController<unknown>>();
  private nextId = 0;

  id(): string {
    this.nextId += 1;
    return `action-${this.nextId}`;
  }

  track(controller: ActionResultController<unknown>): void {
    this.active.add(controller);
  }

  untrack(controller: ActionResultController<unknown>): void {
    this.active.delete(controller);
  }

  clear(): void {
    for (const controller of [...this.active]) controller.cancel();
  }
}

const actionResultControllers = new WeakMap<object, ActionResultController<unknown>>();

function createResult<T>(
  controller: ActionResultController<T>,
): ActionResult<T> {
  const result = {} as ActionResult<T>;
  Object.defineProperties(result, {
    id: { enumerable: true, get: () => controller.snapshot.id },
    state: { enumerable: true, get: () => controller.snapshot.state },
    data: { enumerable: true, get: () => controller.snapshot.data },
    error: { enumerable: true, get: () => controller.snapshot.error },
  });
  Object.freeze(result);
  actionResultControllers.set(
    result,
    controller as ActionResultController<unknown>,
  );
  return result;
}

async function executeAction<TResult, TInput>(
  environment: FetchEnvironment,
  controller: ActionResultController<TResult>,
  url: string | URL,
  options: ActionOptions<TResult, TInput>,
  input: TInput,
): Promise<void> {
  if (!controller.begin()) return;

  try {
    const headers = new Headers(options.headers);
    const body = encodeRequestBody(input, headers);
    const response = await abortable(
      () => environment.fetch()(url, {
        method: options.method ?? 'POST',
        headers,
        body,
        signal: controller.abortController.signal,
      }),
      controller.abortController.signal,
    );
    const result = await abortable(
      () => decodeResponse(response, options.validate) as Promise<TResult>,
      controller.abortController.signal,
    );
    controller.succeed(result);
    try {
      await options.onSuccess?.(result, input);
    } catch {
      // A callback failure does not turn a successful request into an error.
    }
  } catch (cause) {
    if (!isAbortError(cause)) {
      const error = toRequestError(cause);
      controller.fail(error);
      try {
        await options.onError?.(error, input);
      } catch {
        // The request error remains the action failure.
      }
    }
  } finally {
    controller.finish();
  }
}

export function createAction<TResult, TInput>(
  environment: FetchEnvironment,
  store: ActionStore,
  target: string | URL,
  options: ActionOptions<TResult, TInput>,
): Action<TResult, TInput> {
  const url = resolveRequestURL(target, options.query, environment.baseURL);

  const invoke = (input: TInput): ActionResult<TResult> => {
    const controller = new ActionResultController<TResult>(store, store.id());
    const result = createResult(controller);

    // Authored code receives and stores the idle result before work starts.
    queueMicrotask(() => {
      void executeAction(environment, controller, url, options, input);
    });
    return result;
  };

  return invoke as Action<TResult, TInput>;
}

function getController<T>(
  result: ActionResult<T>,
): ActionResultController<T> {
  const controller = actionResultControllers.get(result);
  if (controller === undefined) {
    throw new TypeError('Value is not an action result from @memoized-dom/data');
  }
  return controller as ActionResultController<T>;
}

export function subscribeActionResult<T>(
  result: ActionResult<T>,
  listener: ActionResultListener<T>,
): () => void {
  const controller = getController(result);
  if (controller.disposed) {
    throw new Error('Cannot subscribe to a disposed action result');
  }
  return controller.notifier.subscribe(listener);
}

export function actionResultSnapshot<T>(
  result: ActionResult<T>,
): ActionResultSnapshot<T> {
  return snapshot(getController(result).snapshot);
}

export function disposeActionResult<T>(result: ActionResult<T>): void {
  getController(result).dispose();
}

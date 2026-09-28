import { SnapshotNotifier } from './notifications';
import { fetchResourceSnapshot, isFetchResource, subscribeFetchResource } from './resource';
import type {
  ResourceListener,
  ResourceSnapshot,
  StandardSchemaIssue,
  StandardSchemaV1,
  TrackedValue,
} from './types';

export type FormError =
  | { readonly kind: 'parse'; readonly message: string; readonly path?: readonly PropertyKey[] }
  | { readonly kind: 'submit'; readonly message: string; readonly cause?: unknown };

export interface FormSource<TResult> {
  readonly pending: boolean;
  readonly errors: readonly FormError[];
  readonly hasResult: boolean;
  readonly result: TResult | undefined;
  submit(input: SubmitEvent | FormData): void;
}

export type FormTracker<TResult> = Pick<
  TrackedValue<TResult, FormError>,
  'id' | 'status' | 'pending' | 'refreshing' | 'error' | 'onSuccess' | 'onError'
>;

export interface SchemaFormOptions<TFields, TResult> {
  readonly schema: StandardSchemaV1<unknown, TFields>;
  readonly action: (fields: TFields) => TResult | PromiseLike<TResult>;
}

interface Attempt<T> {
  readonly id: string;
  status: TrackedValue<T, FormError>['status'];
  data: T | undefined;
  error: FormError | null;
  success: Set<(data: T, id: string) => void>;
  failure: Set<(error: FormError, id: string) => void>;
}

interface FormController<T> {
  notifier: SnapshotNotifier<number>;
  current: Attempt<T> | null;
  executing: Attempt<T> | null;
  active: number;
  version: number;
  errors: readonly FormError[];
  hasResult: boolean;
  result: T | undefined;
}

const controllers = new WeakMap<object, FormController<unknown>>();
let nextFormExecutionId = 1;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function reportCallbackError(cause: unknown): void {
  try {
    (globalThis as typeof globalThis & { reportError?: (error: unknown) => void })
      .reportError?.(cause);
  } catch {
    // Listener failures do not change the submission outcome.
  }
}

function deliver<T>(
  listeners: ReadonlySet<(value: T, id: string) => void>,
  value: T,
  id: string,
): void {
  for (const callback of [...listeners]) {
    try {
      callback(value, id);
    } catch (cause) {
      reportCallbackError(cause);
    }
  }
}

function settleOutput<T>(output: T | PromiseLike<T>): Promise<T> {
  if (!isFetchResource(output)) return Promise.resolve(output);
  const resource = output;
  const snapshot = fetchResourceSnapshot(resource);
  if (snapshot.status === 'success' && !snapshot.pending && !snapshot.refreshing) {
    return Promise.resolve(snapshot.data as T);
  }
  if (snapshot.status === 'error' && snapshot.error !== null) {
    return Promise.reject(snapshot.error);
  }
  return new Promise<T>((resolve, reject) => {
    let unsubscribe = () => {};
    let completed = false;
    const observe = (value: ReturnType<typeof fetchResourceSnapshot>) => {
      if (value.status === 'success' && !value.pending && !value.refreshing) {
        completed = true;
        unsubscribe();
        resolve(value.data as T);
      } else if (value.status === 'error' && value.error !== null) {
        completed = true;
        unsubscribe();
        reject(value.error);
      }
    };
    unsubscribe = subscribeFetchResource(resource, observe);
    if (completed) unsubscribe();
  });
}

function formData(event: SubmitEvent): FormData {
  const element = event.currentTarget;
  if (typeof HTMLFormElement === 'undefined' || !(element instanceof HTMLFormElement)) {
    throw new TypeError('form.submit must handle a form submit event');
  }
  return event.submitter === null
    ? new FormData(element)
    : new FormData(element, event.submitter);
}

function createForm<TFields, TResult>(
  action: (fields: TFields) => TResult | PromiseLike<TResult>,
  schema?: StandardSchemaV1<unknown, TFields>,
): FormSource<TResult> {
  const controller: FormController<TResult> = {
    notifier: undefined as unknown as SnapshotNotifier<number>,
    current: null,
    executing: null,
    active: 0,
    version: 0,
    errors: [],
    hasResult: false,
    result: undefined,
  };
  controller.notifier = new SnapshotNotifier(() => controller.version);
  const notify = () => {
    controller.version++;
    controller.notifier.notify();
  };

  const submit = (submission: SubmitEvent | FormData): void => {
    const input = submission instanceof FormData
      ? submission
      : (submission.preventDefault(), formData(submission));
    const attempt: Attempt<TResult> = {
      id: `form-${nextFormExecutionId++}`,
      status: 'pending',
      data: undefined,
      error: null,
      success: new Set(),
      failure: new Set(),
    };
    controller.current = attempt;
    controller.active++;
    controller.errors = [];
    notify();

    const succeed = (data: TResult): void => {
      attempt.status = 'success';
      attempt.data = data;
      controller.active--;
      if (controller.current === attempt) {
        controller.result = data;
        controller.hasResult = true;
      }
      notify();
      deliver(attempt.success, data, attempt.id);
      attempt.success.clear();
      attempt.failure.clear();
    };
    const fail = (error: FormError): void => {
      attempt.status = 'error';
      attempt.error = error;
      controller.active--;
      if (controller.current === attempt) controller.errors = [error];
      notify();
      deliver(attempt.failure, error, attempt.id);
      attempt.success.clear();
      attempt.failure.clear();
    };

    const run = async (): Promise<void> => {
      try {
        let fields: TFields;
        if (schema === undefined) {
          fields = input as TFields;
        } else {
          const candidate = Object.fromEntries(input);
          let parsed: Awaited<ReturnType<typeof schema['~standard']['validate']>>;
          try {
            parsed = await schema['~standard'].validate(candidate);
          } catch (cause) {
            fail({ kind: 'parse', message: message(cause) });
            return;
          }
          if (parsed.issues !== undefined) {
            const errors = parsed.issues.map((issue: StandardSchemaIssue): FormError => ({
              kind: 'parse',
              message: issue.message,
              path: issue.path?.map(segment =>
                typeof segment === 'object' && segment !== null && 'key' in segment
                  ? segment.key
                  : segment,
              ),
            }));
            attempt.status = 'error';
            attempt.error = errors[0] ?? { kind: 'parse', message: 'Invalid form data' };
            controller.active--;
            if (controller.current === attempt) controller.errors = errors;
            notify();
            deliver(attempt.failure, attempt.error, attempt.id);
            attempt.success.clear();
            attempt.failure.clear();
            return;
          }
          fields = parsed.value;
        }
        // An earlier validated attempt may run after a later submit has made
        // another attempt current. Bind $track(form) in this call to its owner.
        const previousExecution = controller.executing;
        controller.executing = attempt;
        let output: TResult | PromiseLike<TResult>;
        try {
          output = action(fields);
        } finally {
          controller.executing = previousExecution;
        }
        succeed(await settleOutput(output));
      } catch (cause) {
        fail({ kind: 'submit', message: message(cause), cause });
      }
    };
    void run();
  };
  const form: FormSource<TResult> = Object.freeze({
    get pending() { return controller.active > 0; },
    get errors() { return controller.errors; },
    get hasResult() { return controller.hasResult; },
    get result() { return controller.result; },
    submit,
  });
  controllers.set(form, controller as FormController<unknown>);
  return form;
}

export function $forms<TResult>(
  action: (fields: FormData) => TResult | PromiseLike<TResult>,
): FormSource<TResult>;
export function $forms<TFields, TResult>(
  options: SchemaFormOptions<TFields, TResult>,
): FormSource<TResult>;
export function $forms<TFields, TResult>(
  input:
    | ((fields: FormData) => TResult | PromiseLike<TResult>)
    | SchemaFormOptions<TFields, TResult>,
): FormSource<TResult> {
  return typeof input === 'function'
    ? createForm(input) as FormSource<TResult>
    : createForm(input.action, input.schema);
}

export function isFormSource(value: unknown): value is FormSource<unknown> {
  return typeof value === 'object' && value !== null && controllers.has(value);
}

export function formSourceSnapshot<T>(form: FormSource<T>): ResourceSnapshot<FormSource<T>> {
  return {
    data: form,
    error: null,
    status: 'success',
    pending: false,
    refreshing: false,
  };
}

export function subscribeFormSource<T>(
  form: FormSource<T>,
  listener: ResourceListener<FormSource<T>>,
): () => void {
  const controller = controllers.get(form);
  if (controller === undefined) throw new TypeError('Not a form source');
  return controller.notifier.subscribe(() => listener(formSourceSnapshot(form)));
}

export function formSourceOperationId<T>(form: FormSource<T>): string {
  return controllers.get(form)?.current?.id ?? '';
}

export function disposeFormSource<T>(form: FormSource<T>): void {
  controllers.get(form)?.notifier.clear();
}

export function trackForm<T>(form: FormSource<T>): FormTracker<T> {
  const controller = controllers.get(form) as FormController<T> | undefined;
  if (controller === undefined) throw new TypeError('Not a form source');
  // Capture the attempt while its action runs. Other submissions may become
  // current before asynchronous schema validation reaches this action.
  const selected = controller.executing;
  const current = () => selected ?? controller.current;
  return Object.freeze({
    get id() { return current()?.id ?? ''; },
    get status() { return current()?.status ?? 'idle'; },
    get pending() { return current()?.status === 'pending'; },
    refreshing: false,
    get error() { return current()?.error ?? null; },
    onSuccess(callback: (data: T, id: string) => void) {
      const attempt = current();
      if (attempt === null) return () => {};
      if (attempt.status === 'success') {
        callback(attempt.data as T, attempt.id);
        return () => {};
      }
      if (attempt.status !== 'pending') return () => {};
      attempt.success.add(callback);
      return () => attempt.success.delete(callback);
    },
    onError(callback: (error: FormError, id: string) => void) {
      const attempt = current();
      if (attempt === null) return () => {};
      if (attempt.status === 'error') {
        callback(attempt.error as FormError, attempt.id);
        return () => {};
      }
      if (attempt.status !== 'pending') return () => {};
      attempt.failure.add(callback);
      return () => attempt.failure.delete(callback);
    },
  }) as FormTracker<T>;
}

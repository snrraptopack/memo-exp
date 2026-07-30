/**
 * refs.ts - mount-only DOM ref callbacks with deterministic teardown.
 *
 * Assignable refs are compiled into this callback contract, so the runtime
 * never needs to understand source l-values or allocate JSX/ref objects.
 */

export type RefCallback<T extends Node = Node> = (
  node: T,
) => void | (() => void);
export type RefValue<T extends Node = Node> =
  | RefCallback<T>
  | readonly RefValue<T>[]
  | null
  | undefined
  | false;

/** Mount refs left-to-right and return one idempotent reverse-order disposer. */
export function mountRef<T extends Node>(
  node: T,
  value: RefValue<T>,
): () => void {
  const disposers: Array<() => void> = [];
  let active = true;

  try {
    mountValue(node, value, disposers);
  } catch (error) {
    const rollbackErrors = drain(disposers);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        '[memo-dom] ref setup and rollback failed',
      );
    }
    throw error;
  }

  return () => {
    if (!active) return;
    active = false;
    const errors = drain(disposers);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, '[memo-dom] multiple ref cleanups failed');
    }
  };
}

function mountValue<T extends Node>(
  node: T,
  value: RefValue<T>,
  disposers: Array<() => void>,
): void {
  if (value == null || value === false) return;
  if (Array.isArray(value)) {
    for (const entry of value) mountValue(node, entry, disposers);
    return;
  }
  if (typeof value !== 'function') {
    throw new TypeError(
      '[memo-dom] ref value must be a callback, an assignable JSX target, or an array of refs',
    );
  }
  const disposer = (value as RefCallback<T>)(node);
  if (disposer == null) return;
  if (typeof disposer !== 'function') {
    throw new TypeError(
      '[memo-dom] ref callback must return a cleanup function or nothing',
    );
  }
  disposers.push(disposer);
}

function drain(disposers: Array<() => void>): unknown[] {
  const errors: unknown[] = [];
  for (let index = disposers.length - 1; index >= 0; index--) {
    try {
      disposers[index]!();
    } catch (error) {
      errors.push(error);
    }
  }
  disposers.length = 0;
  return errors;
}

import type { OptimisticChange } from './types';

interface OptimisticHandlers<TResult> {
  readonly commit: (result: TResult) => void;
  readonly rollback: () => void;
}

const handlers = new WeakMap<object, OptimisticHandlers<unknown>>();

export function createOptimisticChange<TResult>(
  changeHandlers: OptimisticHandlers<TResult>,
): OptimisticChange<TResult> {
  const change: OptimisticChange<TResult> = Object.freeze({
    kind: 'memoized-dom.optimistic-change',
  });
  handlers.set(
    change,
    changeHandlers as OptimisticHandlers<unknown>,
  );
  return change;
}

export function optimisticHandlers<TResult>(
  change: OptimisticChange<TResult>,
): OptimisticHandlers<TResult> {
  const changeHandlers = handlers.get(change);
  if (changeHandlers === undefined) {
    throw new TypeError(
      'Invalid optimistic change. Use append(), replace(), or remove() on a fetch resource.',
    );
  }
  return changeHandlers as OptimisticHandlers<TResult>;
}

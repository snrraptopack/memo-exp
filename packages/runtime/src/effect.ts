/**
 * Component-owned reactive effects.
 *
 * The compiler supplies static subscriptions through the access table and
 * emits local invalidations. The runtime owns only phase ordering and the
 * latest teardown returned by each callback.
 */

import { cleanup, type CleanupDisposer } from './cleanup';
import { markDirty, register, type EntityId } from './kernel';

export type EffectCallback = () => void | CleanupDisposer;

export function registerEffect(
  id: EntityId,
  parent: EntityId,
  callback: EffectCallback,
): void {
  let disposer: CleanupDisposer | undefined;

  register({
    id,
    parent,
    phase: 'effect',
    render() {
      const previous = disposer;
      disposer = undefined;
      previous?.();

      const next = callback();
      if (next !== undefined && typeof next !== 'function') {
        throw new TypeError(
          `[memo-dom] effect '${id}' must return a cleanup function or undefined`,
        );
      }
      disposer = typeof next === 'function' ? next : undefined;
    },
  });

  cleanup(id, () => {
    const current = disposer;
    disposer = undefined;
    current?.();
  });

  // Initial execution uses the same batched post-render phase as reruns.
  markDirty(id);
}

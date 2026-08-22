/**
 * Component-owned reactive effects.
 *
 * The compiler supplies static subscriptions through the access table and
 * emits local invalidations. The runtime owns only phase ordering and the
 * latest teardown returned by each callback.
 */

import { cleanup, type CleanupDisposer } from './cleanup';
import {
  getActiveEnvironment,
  has,
  markDirty,
  register,
  unregisterSubtree,
  type EntityId,
} from './kernel';

export type EffectCallback = () => void | CleanupDisposer;
export type EffectCondition = () => unknown;

export function registerEffect(
  id: EntityId,
  parent: EntityId | null,
  callback: EffectCallback,
): void {
  let disposer: CleanupDisposer | undefined;

  // Stable singleton ids make module reevaluation/HMR teardown-safe.
  if (has(id)) unregisterSubtree(id);

  // Server rendering records the entity so structural ownership stays
  // complete, but never executes the callback. 'defer' will replay it after
  // hydration adoption (Phase 3); until then it behaves as disabled.
  const effects = getActiveEnvironment().effects;
  const execute = effects === 'run';

  register({
    id,
    parent,
    phase: 'effect',
    render() {
      if (!execute) return;
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

  if (!execute) return;

  cleanup(id, () => {
    const current = disposer;
    disposer = undefined;
    current?.();
  });

  // Initial execution uses the same batched post-render phase as reruns.
  markDirty(id);
}

/**
 * Stable activation controller for a conditionally-owned effect.
 *
 * Re-evaluating a truthy condition keeps the existing child registration.
 * A truthy/false transition is the only operation that creates or disposes
 * the active effect lifecycle.
 */
export function registerConditionalEffect(
  id: EntityId,
  parent: EntityId | null,
  condition: EffectCondition,
  callback: EffectCallback,
): void {
  const activeId = `${id}/$active`;
  let active = false;

  if (has(id)) unregisterSubtree(id);

  const effects = getActiveEnvironment().effects;
  const execute = effects === 'run';

  register({
    id,
    parent,
    phase: 'effect',
    render() {
      if (!execute) return;
      const next = Boolean(condition());
      if (next === active) return;
      active = next;
      if (active) registerEffect(activeId, id, callback);
      else unregisterSubtree(activeId);
    },
  });

  if (!execute) return;

  cleanup(id, () => {
    active = false;
    if (has(activeId)) unregisterSubtree(activeId);
  });

  markDirty(id);
}

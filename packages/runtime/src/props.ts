/**
 * @file props.ts
 * R10 — Props-down reactivity: the props box registry.
 *
 * A component's positional props are boxed in ONE mutable array at the call
 * site (`Row(childId, id, [todo, sel])`) and registered here under the child
 * entity id. The parent re-pushes inside its update closure via setProps;
 * the child's update closure re-syncs its locals from the box before running
 * its guarded setters. No subscriptions, no VDOM — a second write channel
 * using the same dirty/mark machinery as state.
 *
 * setProps is the ONLY writer; the box identity never changes (the child's
 * `__p` binding stays valid for the entity's whole lifetime).
 *
 * Object envelopes (`[{ a, b }]`, the shape JSX call sites emit) are diffed
 * per key: identical primitives are unchanged; anything else — objects,
 * functions, new or removed keys — counts as changed, because an identical
 * object may have been mutated in place. When the child registered a
 * key→reason map, the child is dirtied with exactly the reasons of the keys
 * that changed, so its update skips slots that read other props.
 */

import { getExtensionStore, markDirty, onRegistryChange, type EntityId } from './kernel';
import type { DirtyReason, DirtyReasonInput } from './dirty-reasons';

interface PropReasons {
  keys: Readonly<Record<string, DirtyReasonInput>>;
  /** Reason for keys absent from `keys` (rest / whole-object bindings). */
  rest: DirtyReasonInput | undefined;
}

function boxes(): Map<EntityId, unknown[]> {
  return getExtensionStore('prop-boxes', () => new Map<EntityId, unknown[]>());
}

function reasonPlans(): Map<EntityId, PropReasons> {
  return getExtensionStore('prop-reasons', () => new Map<EntityId, PropReasons>());
}

/** Called by compiled child factories right after register(). */
export function registerProps(
  id: EntityId,
  box: unknown[],
  keys?: Readonly<Record<string, DirtyReasonInput>>,
  rest?: DirtyReasonInput,
): void {
  boxes().set(id, box);
  if (keys !== undefined) reasonPlans().set(id, { keys, rest });
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unchanged(previous: unknown, next: unknown): boolean {
  return (
    Object.is(previous, next) &&
    (next === null || (typeof next !== 'object' && typeof next !== 'function'))
  );
}

function pushReasons(
  into: DirtyReason[],
  reason: DirtyReasonInput,
): void {
  if (Array.isArray(reason)) into.push(...(reason as readonly DirtyReason[]));
  else into.push(reason as DirtyReason);
}

function setEnvelope(
  id: EntityId,
  box: unknown[],
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  const changed: string[] = [];
  for (const key in next) {
    if (!(key in previous) || !unchanged(previous[key], next[key])) changed.push(key);
  }
  for (const key in previous) {
    if (!(key in next)) changed.push(key);
  }
  if (changed.length === 0) return;
  box[0] = next;
  const plan = reasonPlans().get(id);
  if (plan === undefined) {
    markDirty(id);
    return;
  }
  const reasons: DirtyReason[] = [];
  for (const key of changed) {
    const reason = plan.keys[key] ?? plan.rest;
    if (reason === undefined) {
      markDirty(id);
      return;
    }
    pushReasons(reasons, reason);
  }
  markDirty(id, reasons);
}

/**
 * Re-push a child's props. Shallow-compares per index: identical values →
 * no dirty, zero work (the common case — parent updated for other reasons).
 * Changed → mutate the box in place and dirty the child entity.
 * Dead letters (unmounted child) are silent no-ops, like markDirty.
 */
export function setProps(id: EntityId, next: readonly unknown[]): void {
  const box = boxes().get(id);
  if (box === undefined) return;
  if (
    box.length === 1 &&
    next.length === 1 &&
    isEnvelope(box[0]) &&
    isEnvelope(next[0])
  ) {
    setEnvelope(id, box, box[0], next[0]);
    return;
  }
  let changed = box.length !== next.length;
  if (!changed) {
    for (let i = 0; i < next.length; i++) {
      if (!Object.is(box[i], next[i])) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return;
  box.length = next.length;
  for (let i = 0; i < next.length; i++) box[i] = next[i];
  markDirty(id);
}

/** Test/devtool introspection only. */
export function _propsBox(id: EntityId): readonly unknown[] | undefined {
  return boxes().get(id);
}

// Boxes die with their entities (M5.6 listener).
onRegistryChange((id, kind) => {
  if (kind === 'remove') {
    boxes().delete(id);
    reasonPlans().delete(id);
  }
});

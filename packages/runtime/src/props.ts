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
 */

import { markDirty, onRegistryChange, type EntityId } from './kernel';

const boxes = new Map<EntityId, unknown[]>();

/** Called by compiled child factories right after register(). */
export function registerProps(id: EntityId, box: unknown[]): void {
  boxes.set(id, box);
}

/**
 * Re-push a child's props. Shallow-compares per index: identical values →
 * no dirty, zero work (the common case — parent updated for other reasons).
 * Changed → mutate the box in place and dirty the child entity.
 * Dead letters (unmounted child) are silent no-ops, like markDirty.
 */
export function setProps(id: EntityId, next: readonly unknown[]): void {
  const box = boxes.get(id);
  if (box === undefined) return;
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
  return boxes.get(id);
}

// Boxes die with their entities (M5.6 listener).
onRegistryChange((id, kind) => {
  if (kind === 'remove') boxes.delete(id);
});

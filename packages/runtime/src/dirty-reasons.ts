/**
 * Batches exact numeric causes for dirty entities until their next render.
 *
 * The pending store lives on the active application runtime so concurrent
 * server renders never observe each other's reasons.
 */
export type DirtyReasonInput = number | readonly number[];
export type DirtyReasons = number | ReadonlySet<number> | null;

type EntityId = string;

/** Per-runtime cause storage; owned by the kernel's application runtime. */
export type DirtyReasonStore = Map<EntityId, number | Set<number>>;

export function createDirtyReasonStore(): DirtyReasonStore {
  return new Map<EntityId, number | Set<number>>();
}

/** Merge an exact cause, or clear causes when the update must be full. */
export function mergeDirtyReasons(
  store: DirtyReasonStore,
  id: EntityId,
  wasDirty: boolean,
  reason: DirtyReasonInput | undefined,
): void {
  if (
    reason === undefined ||
    (Array.isArray(reason) && reason.length === 0)
  ) {
    if (store.size !== 0) store.delete(id);
    return;
  }
  if (!wasDirty) {
    if (typeof reason === 'number') {
      store.set(id, reason);
    } else if (reason.length === 1) {
      store.set(id, reason[0]!);
    } else {
      store.set(id, new Set(reason));
    }
    return;
  }

  const current = store.get(id);
  // A missing entry on an already-dirty entity means full update.
  if (current === undefined) return;
  const incoming = typeof reason === 'number' ? [reason] : reason;
  if (typeof current === 'number') {
    if (incoming.some((value) => value !== current)) {
      store.set(id, new Set([current, ...incoming]));
    }
    return;
  }
  for (const value of incoming) current.add(value);
}

/** Consume pending causes; absence is the full-update sentinel. */
export function takeDirtyReasons(
  store: DirtyReasonStore,
  id: EntityId,
): DirtyReasons {
  if (store.size === 0) return null;
  const reasons = store.get(id) ?? null;
  store.delete(id);
  return reasons;
}

/** Discard causes for an update that was cancelled or became conservative. */
export function clearDirtyReasons(store: DirtyReasonStore, id: EntityId): void {
  if (store.size !== 0) store.delete(id);
}

/**
 * Batches exact numeric causes for dirty entities until their next render.
 *
 * The pending store lives on the active application runtime so concurrent
 * server renders never observe each other's reasons.
 */
export type DirtyReason = number | string;
export type DirtyReasonInput = DirtyReason | readonly DirtyReason[];
export type DirtyReasons = DirtyReason | ReadonlySet<DirtyReason> | null;

type EntityId = string;

/** Per-runtime cause storage; owned by the kernel's application runtime. */
export type DirtyReasonStore = Map<EntityId, DirtyReason | Set<DirtyReason>>;

export function createDirtyReasonStore(): DirtyReasonStore {
  return new Map<EntityId, DirtyReason | Set<DirtyReason>>();
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
    if (typeof reason === 'number' || typeof reason === 'string') {
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
  const incoming: readonly DirtyReason[] =
    typeof reason === 'number' || typeof reason === 'string'
      ? [reason]
      : reason;
  if (!(current instanceof Set)) {
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

/**
 * Emitted gate: does a dirty-reason payload cover one of `values`?
 * `null` means full update and `-1` is the wildcard cause, so both open
 * every gate. `values` may be one cause or a readonly array of them.
 */
export function reasonsHit(
  reasons: DirtyReasons,
  values: DirtyReasonInput,
): boolean {
  if (reasons === null || reasons === -1) return true;
  if (typeof reasons === 'object') {
    if (reasons.has(-1)) return true;
    return typeof values === 'object'
      ? values.some((value) => reasons.has(value))
      : reasons.has(values);
  }
  return typeof values === 'object'
    ? values.includes(reasons)
    : reasons === values;
}

/**
 * Batches exact numeric causes for dirty entities until their next render.
 */
export type DirtyReasonInput = number | readonly number[];
export type DirtyReasons = number | ReadonlySet<number> | null;

type EntityId = string;
const pending = new Map<EntityId, number | Set<number>>();

/** Merge an exact cause, or clear causes when the update must be full. */
export function mergeDirtyReasons(
  id: EntityId,
  wasDirty: boolean,
  reason: DirtyReasonInput | undefined,
): void {
  if (
    reason === undefined ||
    (Array.isArray(reason) && reason.length === 0)
  ) {
    if (pending.size !== 0) pending.delete(id);
    return;
  }
  if (!wasDirty) {
    if (typeof reason === 'number') {
      pending.set(id, reason);
    } else if (reason.length === 1) {
      pending.set(id, reason[0]!);
    } else {
      pending.set(id, new Set(reason));
    }
    return;
  }

  const current = pending.get(id);
  // A missing entry on an already-dirty entity means full update.
  if (current === undefined) return;
  const incoming = typeof reason === 'number' ? [reason] : reason;
  if (typeof current === 'number') {
    if (incoming.some((value) => value !== current)) {
      pending.set(id, new Set([current, ...incoming]));
    }
    return;
  }
  for (const value of incoming) current.add(value);
}

/** Consume pending causes; absence is the full-update sentinel. */
export function takeDirtyReasons(id: EntityId): DirtyReasons {
  if (pending.size === 0) return null;
  const reasons = pending.get(id) ?? null;
  pending.delete(id);
  return reasons;
}

/** Discard causes for an update that was cancelled or became conservative. */
export function clearDirtyReasons(id: EntityId): void {
  if (pending.size !== 0) pending.delete(id);
}

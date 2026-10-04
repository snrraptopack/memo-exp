/** Exact cause merging is selected only by invalidation paths carrying causes. */
import { mergeDirtyReasons, type DirtyReasonInput } from './dirty-reasons';
import {
  enqueueEntityInvalidation, enqueueEntityInvalidations, enqueueSubtreeInvalidation,
  type EntityId,
} from './kernel';

/** General runtime API preserves exact causes and full-update dominance. */
export function markDirty(id: EntityId, reason?: DirtyReasonInput): void {
  enqueueEntityInvalidation(id, reason, mergeDirtyReasons);
}
export function markDirtyMany(ids: readonly EntityId[], reason?: DirtyReasonInput): void {
  enqueueEntityInvalidations(ids, reason, mergeDirtyReasons);
}
export function markDirtySubtree(id: EntityId, ownerId?: EntityId, ownerReason?: DirtyReasonInput): void {
  enqueueSubtreeInvalidation(id, ownerId, ownerReason, mergeDirtyReasons);
}

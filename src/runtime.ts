/**
 * runtime.ts — the single module compiled output imports from.
 *
 * The compiler emits `import * as MD from '<runtimePath>'` and calls every
 * primitive through the `MD.` namespace, so this barrel must re-export the
 * full runtime surface. User code never imports from here directly; only
 * compiler-emitted modules do.
 */

export {
  register,
  unregister,
  unregisterSubtree,
  registeredIds,
  has,
  markDirty,
  markDirtySubtree,
  commit,
  setScheduler,
  resetScheduler,
} from './kernel';
export type { Entity, EntityId } from './kernel';

export {
  setText,
  setClassName,
  setClass,
  setAttr,
  setProp,
  setStyle,
} from './setters';
export type { SlotCache } from './setters';

export { installAccessTable, resetAccessTable, resolveWrites, isOpaque, getRootId } from './access';
export type { AccessTable } from './access';

export { commitWrites, handle, getEventLog, clearEventLog } from './events';
export type { EventRecord } from './events';

export { createListRegion } from './list';
export type { ListRegion, ListEntry, KeyFn } from './list';

export { createCondRegion } from './cond';
export type { CondRegion, CondEntry, CondBranchFactory } from './cond';

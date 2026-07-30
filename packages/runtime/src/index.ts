/**
 * Runtime package entry imported by compiler output.
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
  undirty,
  markDirtySubtree,
  commit,
  setScheduler,
  resetScheduler,
  getEntity,
  renderDescendants,
} from './kernel';
export type {
  DirtyReasonInput,
  DirtyReasons,
  Entity,
  EntityId,
} from './kernel';
export { cleanup } from './cleanup';
export type { CleanupDisposer } from './cleanup';
export { registerConditionalEffect, registerEffect } from './effect';
export type { EffectCallback, EffectCondition } from './effect';

export {
  setText,
  setClassName,
  setClass,
  setAttr,
  setProp,
  setStyle,
  computedChanged,
} from './setters';
export type { SlotCache } from './setters';

export { installAccessTable, resetAccessTable, resolveWrites, isOpaque, getRootId } from './access';
export type { AccessTable } from './access';

export { commitWrites, handle, getEventLog, clearEventLog } from './events';
export type { EventRecord } from './events';

export { createListRegion } from './list';
export type { ListRegion, ListEntry, KeyFn } from './list';
export { rootNodes } from './jsx-dom';
export { patchDomProps, setDomValue } from './dom-props';
export { classValue, setClassValue, setStyleValue } from './dom-values';

export { createCondRegion } from './cond';
export { registerProps, setProps } from './props';
export type { CondRegion, CondEntry, CondBranchFactory } from './cond';

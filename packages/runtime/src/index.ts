/**
 * Runtime package entry imported by compiler output.
 *
 * The compiler emits `import * as MD from '<runtimePath>'` and calls every
 * primitive through the `MD.` namespace, so this barrel must re-export the
 * full runtime surface. Ordinary browser entries additionally import mount;
 * reactive and emission primitives remain compiler-owned.
 */

export {
  register,
  registerEntity,
  unregister,
  unregisterSubtree,
  registeredIds,
  has,
  markDirty,
  invalidateEntity,
  undirty,
  markDirtySubtree,
  commit,
  setScheduler,
  resetScheduler,
  getEntity,
  renderDescendants,
  createApplicationRuntime,
  getActiveApplicationRuntime,
  getExtensionStore,
  setActiveApplicationRuntime,
  runWithApplicationRuntime,
  getActiveEnvironment,
  canReuseTemplate,
  runWithRenderEnvironment,
} from './kernel';
export { createStorage, type StorageShim } from './async-storage';
export type {
  ApplicationRuntime,
  DirtyReasonInput,
  DirtyReasons,
  Entity,
} from './kernel';
export { reasonsHit, reasonsOnly } from './dirty-reasons';
export type {
  Capability,
  DocumentLike,
  RenderEnvironment,
  RenderMode,
} from './environment';
export {
  defineStateCell,
  readCell,
  setCell,
  updateCell,
} from './state-cells';
export type { StateCell } from './state-cells';
export { cleanup } from './cleanup';
export { readPreparationScope, releasePreparationRead } from './preparation-read';
export { createPreparedRegion } from './prepared-region';
export { collectRenderReadiness } from './render-readiness';
export { toPresentationError, type PresentationError, type PresentationErrorKind } from './presentation-error';
export type { CleanupDisposer } from './cleanup';
export { mountRef, refAssign } from './refs';
export type { RefCallback, RefValue } from './refs';
export { registerConditionalEffect, registerEffect } from './effect';
export type { EffectCallback, EffectCondition } from './effect';

export { materializeMarkup } from './markup';
export { adoptInitialRoot } from './initial-root';
export { bindInitialNodes } from './initial-bindings';
export { bindInitialListNodes } from './initial-list-bindings';
export { bindInitialRegionNodes } from './initial-region-bindings';
export { bindInitialList } from './initial-list';
export { bindInitialInputValue } from './initial-input';

export {
  setText,
  setTextData,
  textValue,
  setClassName,
  setClass,
  setAttr,
  setProp,
  setStyle,
  computedChanged,
  effectAssignmentChanged,
} from './setters';
export type { SlotCache } from './setters';

export {
  installAccessTable,
  resetAccessTable,
  uninstallAccessTable,
  resolveWrites,
  resolveStaticWrites,
  isOpaque,
  getRootId,
} from './access';
export type { AccessTable } from './access';

export {
  commitStructuralWrites,
  commitListItemWrites,
  commitWrites,
  commitWritesWithPayload,
  handle,
  getEventLog,
  clearEventLog,
} from './events';
export type { EventRecord } from './events';

export { createListRegion } from './list';
export { createPositionalListRegion } from './list-positional';
export type { ListRegion, ListEntry, KeyFn } from './list';
export { isStructuralListUpdate, listItemIndices, createListProvenance, evaluateListOperation } from './list-update';
export { rootNodes } from './jsx-dom';
export { decodeListKey, encodeListKey } from './list-keys';
export { HydrationMismatchError } from './hydration-error';
export { mount } from './mount';
export { mountInitial, registerRootFactory, rootFactoryStore } from './mount-core';
export { initializePayload } from './payload';
export type {
  MountableComponent,
  MountOptions,
  MountTarget,
  MountedApplication,
  RootMountContext,
} from './mount';
export {
  createDelegatedEventBinding,
  setDelegatedEvent,
  type DelegatedEventBinding,
} from './delegated-events';
export { patchDomProps, setDomValue } from './dom-props';
export { classValue, setClassValue, setStyleValue } from './dom-values';
export { createCondRegion } from './cond';
export { registerProps, setProps } from './props';
export type { CondRegion, CondEntry, CondBranchFactory } from './cond';

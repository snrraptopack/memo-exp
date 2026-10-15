/**
 * Existing application semantics for rendering hosts.
 *
 * This entry selects no DOM mount, hydration tier, or server storage provider.
 * A host supplies entity render callbacks and its accepted publication boundary;
 * state cells, access routing, effects, refs and cleanup remain the shared core.
 */
export {
  createApplicationRuntime,
  getActiveApplicationRuntime,
  runWithApplicationRuntime,
  runInApplicationRuntime,
  runWithRenderEnvironment,
  getActiveEnvironment,
  registerEntity,
  register,
  unregisterSubtree,
  invalidateEntity,
  markDirty,
  markDirtySubtree,
  commit,
  setScheduler,
  getExtensionStore,
} from './kernel';
export type { ApplicationRuntime, Entity, DirtyReasons } from './kernel';
export type { RenderEnvironment } from './environment';

export { installAccessTable, resolveStaticWrites } from './access';
export type { AccessTable } from './access';
export { commitWrites, commitStructuralWrites, commitListItemWrites } from './events';
export { defineStateCell, readCell, setCell, updateCell, stateCellSlot } from './state-cells';
export { setStorageFactory } from './async-storage';
export { computedChanged, effectAssignmentChanged } from './comparison';
export { registerEffect, registerConditionalEffect } from './effect';
export { cleanup } from './cleanup';
export { registerProps, setProps } from './props';
export { createRenderPreparation, type RenderPreparation } from './preparation';
export { readPreparationScope, releasePreparationRead } from './preparation-read';
export { mountRef, refAssign } from './refs';
export type { RefTarget, RefValue, RefCallback } from './refs';
export { textValue, classValue } from './value-normalization';
export { jsxAttributeName } from './jsx-attributes';
export { isAriaAttribute, isHtmlBooleanAttribute } from './html-attributes';
export { rootFactoryStore } from './root-factories';
// Host-neutral identity encoding; DOM reconciliation stays in its own entry.
export { encodeListKey } from './list-keys';

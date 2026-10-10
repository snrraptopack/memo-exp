/**
 * Semantic runtime entry for rendering hosts.
 *
 * This entry initializes no browser or server host. Rendering adapters supply
 * entity update functions and keep their own destination publication boundary.
 * Importing the normal package entry would also select DOM mounting helpers.
 */
export {
  createApplicationRuntime,
  getActiveApplicationRuntime,
  runInApplicationRuntime,
  runWithApplicationRuntime,
  registerEntity,
  unregisterSubtree,
  invalidateEntity,
  markDirty,
  markDirtySubtree,
  commit,
  setScheduler,
  getExtensionStore,
} from './kernel';
export type { ApplicationRuntime, Entity, DirtyReasons } from './kernel';
export { installAccessTable, resolveStaticWrites } from './access';
export type { AccessTable } from './access';
export { commitWrites, commitStructuralWrites, commitListItemWrites } from './events';
export { defineStateCell, readCell, setCell, updateCell } from './state-cells';
export { setStorageFactory } from './async-storage';
export { computedChanged, effectAssignmentChanged } from './comparison';

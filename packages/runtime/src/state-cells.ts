/**
 * state-cells.ts - SSR Phase 1.3 (proposal Option B) storage primitive.
 *
 * Module-level reactive state (`export let count = 0`) compiles today to
 * ordinary ESM bindings, which are singletons: two concurrent server requests
 * would share one memory cell. State cells give the compiler a lowering
 * target where the STORAGE is owned by each application runtime while the
 * canonical linker identity stays stable for invalidation routing.
 *
 * Authored:
 *   export let count = 0;
 *   export function inc() { count++; }
 *
 * Lowered shape the compiler emits (prototype contract):
 *   const _c_count = defineStateCell('./src/state.ts#count', 0);
 *   export function inc() {
 *     setCell(_c_count, (current) => current + 1);
 *   }
 *   // every read site: readCell(_c_count)
 *
 * Writes invalidate readers through the existing access table by canonical
 * key, so computed entities, effects, and component updates need no changes.
 * Values initialize lazily per runtime from the declared initial, so a fresh
 * request starts from authored defaults without re-evaluating the module.
 */

import { commitWrites } from './events';
import { getActiveApplicationRuntime } from './kernel';

export interface StateCell<T> {
  /** Canonical linker identity, e.g. './src/state.ts#count'. */
  readonly key: string;
  readonly initial: T;
}

export function defineStateCell<T>(key: string, initial: T): StateCell<T> {
  return { key, initial };
}

function slot<T>(cell: StateCell<T>): { value: T } {
  const runtime = getActiveApplicationRuntime();
  let holder = runtime.state.cells.get(cell.key) as { value: T } | undefined;
  if (holder === undefined) {
    holder = { value: cell.initial };
    runtime.state.cells.set(cell.key, holder);
  }
  return holder;
}

/** Read this request's value of the cell. Initializes from `initial` once. */
export function readCell<T>(cell: StateCell<T>): T {
  return slot(cell).value;
}

/**
 * Write this request's value and route invalidation through the access
 * table under the cell's canonical key — identical routing to an ordinary
 * authored state write.
 */
export function setCell<T>(cell: StateCell<T>, value: T): void {
  slot(cell).value = value;
  commitWrites([cell.key]);
}

/** Functional write; receives the request's current value. */
export function updateCell<T>(
  cell: StateCell<T>,
  change: (current: T) => T,
): void {
  setCell(cell, change(slot(cell).value));
}

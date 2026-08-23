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
 *   export const store = { items: [] };
 *   export function inc() { count++; store.items.push(count); }
 *
 * Lowered shape the compiler emits (owning module passes its authored
 * default; importing modules reference the same canonical key):
 *   const _c_count = _MD.defineStateCell('./src/state.ts#count', 0);
 *   const _c_store = _MD.defineStateCell('./src/state.ts#store', () => ({ items: [] }));
 *   export function inc() {
 *     _MD.updateCell(_c_count, (c) => c + 1);
 *     _MD.readCell(_c_store).items.push(_MD.readCell(_c_count));
 *   }
 *
 * Values initialize lazily per application runtime from the recorded
 * default. Factory initials produce a FRESH value for every request, so
 * mutated object stores never share instances across requests. Writes
 * invalidate readers through the existing access table by canonical key,
 * so computed entities, effects, and component updates need no changes.
 */

import { commitWrites } from './events';
import { getActiveApplicationRuntime } from './kernel';

export interface StateCell {
  /** Canonical linker identity, e.g. './src/state.ts#count'. */
  readonly key: string;
}

/**
 * Process-wide authored defaults, recorded when modules evaluate. Stored as
 * the raw input (value or factory) so every runtime can resolve a fresh
 * instance. ESM postorder evaluation guarantees an owning module registers
 * its default before any importer references the key.
 */
const authoredDefaults = new Map<string, unknown>();

/**
 * Declare a cell under a canonical identity. The module that OWNS the state
 * passes its authored default - a value, or a factory for object state so
 * each request gets a fresh instance. Importing modules call it with the
 * same key and no initial.
 */
export function defineStateCell<T>(
  key: string,
  initial?: T | (() => T),
): StateCell {
  if (initial !== undefined) authoredDefaults.set(key, initial);
  return { key };
}

function instantiate(input: unknown): unknown {
  return typeof input === 'function' ? (input as () => unknown)() : input;
}

function slot<T>(cell: StateCell): { value: T } {
  const runtime = getActiveApplicationRuntime();
  let holder = runtime.state.cells.get(cell.key) as { value: T } | undefined;
  if (holder === undefined) {
    holder = {
      value: instantiate(authoredDefaults.get(cell.key)) as T,
    };
    runtime.state.cells.set(cell.key, holder);
  }
  return holder;
}

/** Read this request's value of the cell. Initializes from the default once. */
export function readCell<T>(cell: StateCell): T {
  return slot<T>(cell).value;
}

/**
 * Write this request's value and route invalidation through the access
 * table under the cell's canonical key — identical routing to an ordinary
 * authored state write.
 */
export function setCell<T>(cell: StateCell, value: T): void {
  slot(cell).value = value;
  commitWrites([cell.key]);
}

/** Functional write; receives the request's current value. */
export function updateCell<T>(
  cell: StateCell,
  change: (current: T) => T,
): void {
  setCell(cell, change(slot<T>(cell).value));
}

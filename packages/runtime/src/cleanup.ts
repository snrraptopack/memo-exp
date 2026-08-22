/**
 * cleanup.ts - explicit component-owned teardown.
 *
 * The compiler lowers source `cleanup(disposer)` calls to
 * `cleanup(componentId, disposer)`. Registrations may happen before the
 * component enters the entity registry; unregistering the entity owns and
 * synchronously drains its disposers.
 *
 * Disposer storage lives on the active application runtime, so concurrent
 * server requests never drain each other's teardowns.
 */

import { getExtensionStore, onEntityDispose, type EntityId } from './kernel';

export type CleanupDisposer = () => void;

interface CleanupStore {
  readonly cleanups: Map<EntityId, CleanupDisposer[]>;
  readonly disposingOwners: Set<EntityId>;
}

function store(): CleanupStore {
  return getExtensionStore('cleanup', () => ({
    cleanups: new Map<EntityId, CleanupDisposer[]>(),
    disposingOwners: new Set<EntityId>(),
  }));
}

let disposalInstalled = false;

function ensureDisposalInstalled(): void {
  if (disposalInstalled) return;
  disposalInstalled = true;
  onEntityDispose(disposeOwnerCleanups);
}

/** Register one disposer for an entity and return it unchanged. */
export function cleanup(
  owner: EntityId,
  disposer: CleanupDisposer,
): CleanupDisposer {
  if (typeof disposer !== 'function') {
    throw new TypeError('[memo-dom] cleanup(disposer) requires a function');
  }
  if (store().disposingOwners.has(owner)) {
    throw new Error(
      `[memo-dom] cannot register cleanup while '${owner}' is being unregistered`,
    );
  }
  ensureDisposalInstalled();
  const cleanups = store().cleanups;
  let disposers = cleanups.get(owner);
  if (disposers === undefined) {
    disposers = [];
    cleanups.set(owner, disposers);
  }
  disposers.push(disposer);
  return disposer;
}

/**
 * Drain an owner's disposers in reverse registration order.
 * Teardown continues after individual failures; the kernel reports them once
 * the complete subtree has been removed.
 */
export function disposeOwnerCleanups(owner: EntityId): unknown[] {
  const { cleanups, disposingOwners } = store();
  const disposers = cleanups.get(owner);
  if (disposers === undefined) return [];

  cleanups.delete(owner);
  disposingOwners.add(owner);
  const errors: unknown[] = [];
  try {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        disposers[i]!();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    disposingOwners.delete(owner);
  }
  return errors;
}

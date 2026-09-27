import { getEntity } from './kernel';

/** @internal Compiler-owned read scope. Ordinary mounted renders are a no-op. */
export function readPreparationScope<T>(owner: string, site: string, read: () => T): T {
  const preparation = getEntity(owner)?.preparation;
  return preparation === undefined ? read() : preparation.collect(owner, read, site);
}

/** @internal A branch can disappear without unregistering its enclosing owner. */
export function releasePreparationRead(owner: string, site: string): void {
  getEntity(owner)?.preparation?.releaseRead(owner, site);
}

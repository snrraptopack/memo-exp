import type { DirtyReasons } from './dirty-reasons';

/**
 * Compiler/runtime protocol for a write proven to affect list structure.
 *
 * This describes the write's observable boundary, not the authored operation:
 * no array method names are encoded. The list still verifies keys and order;
 * the reason only proves that unchanged retained item identities do not need
 * their row content replayed.
 */
const LIST_STRUCTURE_PREFIX = '\0memo-dom:list-structure:';
const LIST_STRUCTURE_READER_SUFFIX = '\0memo-dom:list-structure-reader';
const LIST_ITEM_PREFIX = '\0memo-dom:list-item:';

export function listItemReason(source: string, index: number): string {
  return `${LIST_ITEM_PREFIX}${JSON.stringify(source)}:${index}`;
}

/** Only a complete set of matching content reasons permits selective replay. */
export function listItemIndices(reasons: DirtyReasons, source: string): number[] | null {
  const prefix = `${LIST_ITEM_PREFIX}${JSON.stringify(source)}:`;
  const values = reasons instanceof Set ? reasons : [reasons];
  const indices: number[] = [];
  for (const reason of values) {
    if (typeof reason !== 'string' || !reason.startsWith(prefix)) return null;
    const index = Number(reason.slice(prefix.length));
    if (!Number.isSafeInteger(index) || index < 0) return null;
    indices.push(index);
  }
  return indices.length === 0 ? null : indices;
}

export function listStructureReason(source: string): string {
  return `${LIST_STRUCTURE_PREFIX}${source}`;
}

export function listStructureReaderKey(source: string): string {
  return `${source}${LIST_STRUCTURE_READER_SUFFIX}`;
}

export function isStructuralListUpdate(
  reasons: DirtyReasons,
  source: string,
): boolean {
  const expected = listStructureReason(source);
  if (reasons === expected) return true;
  if (!(reasons instanceof Set) || !reasons.has(expected)) return false;
  for (const reason of reasons) {
    if (
      typeof reason !== 'string' ||
      !reason.startsWith(LIST_STRUCTURE_PREFIX)
    ) {
      return false;
    }
  }
  return true;
}

export function retainedRowNeedsSync<T>(
  previous: T,
  next: T,
  previousIndex: number,
  nextIndex: number,
  indexSensitive: boolean,
): boolean {
  return previous !== next || (indexSensitive && previousIndex !== nextIndex);
}

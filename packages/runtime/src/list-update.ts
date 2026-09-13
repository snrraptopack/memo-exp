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

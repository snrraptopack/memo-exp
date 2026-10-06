/** Optional row adoption over the shared hydration document and marker index. */
import { HydrationMismatchError } from './hydration-error';
import type { ClaimedHydrationList, HydrationDocument } from './hydration';

export function hydrateList(document: HydrationDocument, parent: Node, identity: string): ClaimedHydrationList {
  const range = document.claimRange('l', identity);
  document.recordFragmentRange(parent, range);
  let next: Node | null = range.open.nextSibling;
  return {
    open: range.open,
    end: range.end,
    adoptRow: <T>(key: unknown, encoded: string | null, create: () => T) => {
      if (encoded === null) {
        throw new HydrationMismatchError(identity, 'a hydration-stable primitive row key', `${typeof key} key`);
      }
      const row = document.claimRow(identity, encoded);
      if (row.open !== next) {
        const actual = next?.nodeType === 8
          ? `<!--${(next as Comment).data}-->` : 'a row at a different server position';
        throw new HydrationMismatchError(`${identity}:${encoded}`, `<!--mmd:w:${identity}:${encoded}--> in client key order`, actual);
      }
      next = row.end;
      document.pushRange(row);
      let value: T;
      let failed = false;
      let failure: unknown;
      try { value = create(); }
      catch (error) { failed = true; failure = error; }
      try { document.popRange(); }
      catch (error) { if (!failed) throw error; }
      if (failed) throw failure;
      return { value: value!, marker: row.open };
    },
    finish: () => {
      if (next !== range.end) {
        throw new HydrationMismatchError(identity, 'the list close after the final client row', 'additional server row content');
      }
    },
  };
}

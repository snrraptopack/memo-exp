/** Shared list anchors and row creation; SSR adoption is supplied by the host. */
import { getActiveEnvironment, type EntityId } from './kernel';
import type { ListEntry } from './list';

/** Compiler-proven, single-host rows in an initial HTML range. */
export interface InitialListDOM { readonly open: Node; readonly end: Node; readonly rows: readonly Node[]; readonly dispose: () => void }

export function removeListDOMRange(parent: Node, open: Node, end: Node, first: Node | undefined,
  wholeResourceFree: boolean, isDisposed: () => boolean): boolean {
  const container = end.parentNode ?? parent;
  if (first === undefined) return false;
  if (wholeResourceFree && container.firstChild === open && container.lastChild === end &&
      open.nextSibling === first && typeof (container as ParentNode).replaceChildren === 'function') {
    (container as ParentNode).replaceChildren(open, end);
    if (isDisposed()) {
      let errors: unknown[] | null = null;
      for (const anchor of [open, end]) {
        try { anchor.parentNode?.removeChild(anchor); } catch (error) { (errors ??= []).push(error); }
      }
      if (errors?.length === 1) throw errors[0];
      if (errors !== null) throw new AggregateError(errors, '[memo-dom] list anchor disposal failed');
    }
    return true;
  }
  const doc = getActiveEnvironment().document;
  if (first.parentNode !== container || end.parentNode !== container || doc.createRange === undefined) return false;
  const range = doc.createRange(); range.setStartBefore(first); range.setEndBefore(end); range.deleteContents();
  return true;
}

export function createListDOM<T>(
  parent: Node,
  idPrefix: EntityId,
  create: (item: T, rowId: EntityId, index: number, initialRoot?: Node) => ListEntry,
  isDisposed: () => boolean,
  cleanup: (entry: ListEntry) => void,
  initial?: InitialListDOM,
) {
  const environment = getActiveEnvironment();
  let adopted = initial ? undefined : environment.hydration?.claimList(parent, idPrefix);
  const open = initial?.open ?? adopted?.open ?? environment.document.createComment(`mmd:l:${idPrefix}`);
  const end = initial?.end ?? adopted?.end ?? environment.document.createComment('/mmd');
  let initialRows=initial?.rows;
  let initialDispose=initial?.dispose;
  if (initial === undefined && adopted === undefined) {
    parent.appendChild(open); parent.appendChild(end);
  }
  const dom = { environment, open, end, adopting: adopted !== undefined || initialRows!==undefined, createRow, finishAdoption, dispose };
  return dom;

  function createRow(item: T, key: unknown, rowId: EntityId, index: number, encoded: string | null): ListEntry | null {
    if (initialRows && index>=initialRows.length) throw new Error('memo-dom: initial list received additional client rows');
    let entry: ListEntry;
    let rowMarker: Comment | undefined;
    if (adopted) {
      const row = adopted.adoptRow(key, encoded, () => create(item, rowId, index));
      entry = row.value;
      rowMarker = row.marker;
    } else entry = initialRows ? create(item, rowId, index, initialRows[index]) : create(item, rowId, index);
    if (isDisposed()) { cleanup(entry); return null; }
    if (encoded !== null && environment.mode !== 'client-create') {
      const marker = rowMarker ?? getActiveEnvironment().document.createComment(`mmd:w:${idPrefix}:${encoded}`);
      const nodes = entry.nodes;
      entry.nodes = Array.isArray(nodes) ? [marker, ...nodes] : [marker, nodes as Node];
    }
    return entry;
  }

  function finishAdoption(): void {
    if (!dom.adopting) return;
    if (initialRows) { initialRows=undefined;initialDispose=undefined;dom.adopting=false;return; }
    adopted!.finish();
    adopted = undefined;
    dom.adopting = false;
  }

  function dispose(errors: unknown[] | null): unknown[] | null {
    const release=initialDispose;
    initialRows=undefined;initialDispose=undefined;
    try { release?.(); } catch (error) { (errors ??= []).push(error); }
    // Reuse the existing owner reference; do not add two captured anchor slots.
    for (const anchor of [dom.end, dom.open]) {
      try { anchor.parentNode?.removeChild(anchor); } catch (error) { (errors ??= []).push(error); }
    }
    return errors;
  }
}

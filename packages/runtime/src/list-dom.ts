/** Shared list anchors, row creation and hydration protocol. */
import { getActiveEnvironment, type EntityId } from './kernel';
import { HydrationMismatchError } from './hydration-error';
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
  const controller = environment.hydration;
  const adopted = initial ? undefined : controller?.claimRange('l', idPrefix);
  const open = initial?.open ?? adopted?.open ?? environment.document.createComment(`mmd:l:${idPrefix}`);
  const end = initial?.end ?? adopted?.end ?? environment.document.createComment('/mmd');
  let initialRows=initial?.rows;
  let initialDispose=initial?.dispose;
  if (initial === undefined && adopted === undefined) {
    parent.appendChild(open); parent.appendChild(end);
  } else if (adopted !== undefined) controller!.recordFragmentRange(parent, adopted);
  let nextAdoptedRow: Node | null = adopted?.open.nextSibling ?? null;
  const dom = { environment, open, end, adopting: adopted !== undefined || initialRows!==undefined, createRow, finishAdoption, disposeInitial };
  return dom;

  function createRow(item: T, key: unknown, rowId: EntityId, index: number, encoded: string | null): ListEntry | null {
    if (dom.adopting && !initialRows && encoded === null) {
      throw new HydrationMismatchError(idPrefix, 'a hydration-stable primitive row key', `${typeof key} key`);
    }
    const row = dom.adopting && !initialRows ? controller!.claimRow(idPrefix, encoded!) : undefined;
    if (initialRows && index>=initialRows.length) throw new Error('memo-dom: initial list received additional client rows');
    if (row !== undefined && row.open !== nextAdoptedRow) {
      const actual = nextAdoptedRow?.nodeType === 8
        ? `<!--${(nextAdoptedRow as Comment).data}-->` : 'a row at a different server position';
      throw new HydrationMismatchError(`${idPrefix}:${encoded}`, `<!--mmd:w:${idPrefix}:${encoded}--> in client key order`, actual);
    }
    if (row !== undefined) { nextAdoptedRow = row.end; controller!.pushRange(row); }
    let entry: ListEntry | undefined;
    let failed = false;
    let failure: unknown;
    try { entry = initialRows ? create(item, rowId, index, initialRows[index]) : create(item, rowId, index); }
    catch (error) { failed = true; failure = error; }
    if (row !== undefined) {
      try { controller!.popRange(); }
      catch (error) { if (!failed) throw error; }
    }
    if (failed) throw failure;
    if (isDisposed()) { cleanup(entry!); return null; }
    if (encoded !== null && environment.mode !== 'client-create') {
      const marker = row?.open ?? getActiveEnvironment().document.createComment(`mmd:w:${idPrefix}:${encoded}`);
      const nodes = entry!.nodes;
      entry!.nodes = Array.isArray(nodes) ? [marker, ...nodes] : [marker, nodes as Node];
    }
    return entry!;
  }

  function finishAdoption(): void {
    if (!dom.adopting) return;
    if (initialRows) { initialRows=undefined;initialDispose=undefined;dom.adopting=false;return; }
    if (nextAdoptedRow !== adopted!.end) {
      throw new HydrationMismatchError(idPrefix, 'the list close after the final client row', 'additional server row content');
    }
    dom.adopting = false;
  }

  function disposeInitial(): void {
    const dispose=initialDispose;
    initialRows=undefined;initialDispose=undefined;
    dispose?.();
  }
}

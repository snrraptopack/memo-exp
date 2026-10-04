/** Compiler-selected index keys for rows that own DOM only. */
import { getActiveEnvironment, type EntityId } from './kernel';
import { createListDOM, removeListDOMRange, type InitialListDOM } from './list-dom';
import { copyListItems } from './list-update';
import type { ListEntry, ListRegion } from './list';

export function createPositionalListRegion<T>(
  parent: Node,
  idPrefix: EntityId,
  create: (item: T, rowId: EntityId, index: number, initialRoot?: Node) => ListEntry,
  initial?: InitialListDOM,
): ListRegion<T> {
  const rows: ListEntry[] = [];
  let previous: T[] = [];
  let disposed = false;
  let generation = 0;
  let active: { cursor: number } | null = null;
  const initialCount=initial?.rows.length;
  const dom = createListDOM(parent, idPrefix, create, () => disposed, remove, initial);

  function nodes(entry: ListEntry): readonly Node[] {
    return Array.isArray(entry.nodes) ? entry.nodes : [entry.nodes as Node];
  }
  function remove(entry: ListEntry): void {
    let errors: unknown[] | null = null;
    for (const node of nodes(entry)) {
      try { node.parentNode?.removeChild(node); }
      catch (error) { (errors ??= []).push(error); }
    }
    report(errors);
  }
  function report(errors: unknown[] | null): void {
    if (errors === null) return;
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, `[memo-dom] list '${idPrefix}' disposal failed`);
  }
  function reconcile(items: readonly T[], structuralOnly = false, appendOnly = false): void {
    if (disposed) return;
    if (!Array.isArray(items)) {
      throw new TypeError(`[memo-dom] list '${idPrefix}' requires an array; received ${items === null ? 'null' : typeof items}`);
    }
    if (initialCount!==undefined && dom.adopting && items.length!==initialCount) throw new Error('memo-dom: initial list row count does not match the client state');
    const recovering = active !== null;
    generation++;
    const retained = rows.length;
    const frame = { cursor: 0 };
    active = frame;
    const adopting = dom.adopting;
    for (let index = 0; index < items.length; index++) {
      const item = items[index] as T;
      if (disposed || active !== frame) return;
      frame.cursor = index + 1;
      const entry = rows[index];
      if (entry !== undefined) {
        if (recovering || !structuralOnly || (!appendOnly && previous[index] !== item)) {
          entry.update?.(item, index);
        }
      } else {
        // The same numeric key protocol is used by the keyed server path.
        const encoded = dom.environment.mode === 'client-create' ? null : `n:${index}`;
        const created = dom.createRow(item, index, idPrefix, index, encoded);
        if (created === null) return;
        if (disposed || active !== frame) { remove(created); return; }
        // Publish ownership before DOM insertion, which may invoke authored code.
        rows.push(created);
      }
      if (disposed || active !== frame) return;
    }
    if (adopting) dom.finishAdoption();
    let errors: unknown[] | null = null;
    const removed: ListEntry[] = [];
    while (rows.length > items.length) {
      // Retire first: synchronous host callbacks cannot refresh removed rows.
      removed.push(rows.pop()!);
    }
    if (removed.length > 0) {
      let first: Node | undefined;
      for (let index = removed.length - 1; index >= 0 && first === undefined; index--) first = nodes(removed[index]!)[0];
      let rangeRemoved = false;
      try { rangeRemoved = removeListDOMRange(parent, dom.open, dom.end, first, rows.length === 0 && !dom.adopting, () => disposed); }
      catch (error) { (errors ??= []).push(error); }
      if (!rangeRemoved) for (const entry of removed) {
        try { remove(entry); } catch (error) { (errors ??= []).push(error); }
      }
      if (disposed || active !== frame) { report(errors); return; }
    }
    report(errors);
    // Ordinarily only the new suffix needs insertion. An interrupted frame
    // may have left detached rows; restore the complete order on retry.
    if (!adopting) {
      if (!recovering && rows.length > retained) {
        const fragment = getActiveEnvironment().document.createDocumentFragment();
        for (let index = retained; index < rows.length; index++) for (const node of nodes(rows[index]!)) {
          fragment.appendChild(node);
          if (disposed || active !== frame) return;
        }
        (dom.end.parentNode ?? parent).insertBefore(fragment, dom.end);
        if (disposed || active !== frame) return;
      }
      if (recovering) {
        let cursor: Node = dom.end;
        for (let index = rows.length - 1; index >= 0; index--) {
          const extent = nodes(rows[index]!);
          for (let part = extent.length - 1; part >= 0; part--) {
            const node = extent[part]!;
            if (node.parentNode !== dom.end.parentNode || node.nextSibling !== cursor) {
              (dom.end.parentNode ?? parent).insertBefore(node, cursor);
              if (disposed || active !== frame) return;
            }
            cursor = node;
          }
        }
      }
    }
    const snapshot = copyListItems(items);
    if (disposed || active !== frame) return;
    previous = snapshot;
    active = null;
  }
  function refreshKey(key: unknown): void {
    if (disposed || typeof key !== 'number' || !Number.isInteger(key) || key < 0 ||
        active !== null && key < active.cursor) return;
    rows[key]?.update?.(previous[key], key);
  }
  function refreshIndices(items: readonly T[], indices: readonly number[], fixedPositions = false): void {
    if (disposed) return;
    const revision = generation;
    if (!Array.isArray(items) || dom.adopting || active !== null || items.length !== previous.length ||
        !fixedPositions && items.some((item, index) => item !== previous[index])) {
      reconcile(items); return;
    }
    if (disposed || generation !== revision) return;
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0) continue;
      rows[index]?.update?.(items[index], index);
      if (disposed || generation !== revision) return;
    }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    generation++;
    active = null;
    previous = [];
    let errors: unknown[] | null = null;
    while (rows.length > 0) {
      try { remove(rows.pop()!); } catch (error) { (errors ??= []).push(error); }
    }
    try {dom.disposeInitial();} catch(error) {(errors??=[]).push(error);}
    for (const anchor of [dom.end, dom.open]) {
      try { anchor.parentNode?.removeChild(anchor); } catch (error) { (errors ??= []).push(error); }
    }
    report(errors);
  }
  return { reconcile, refreshKey, refreshIndices, size: () => disposed ? 0 : rows.length, dispose };
}

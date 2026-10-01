/**
 * @file list.ts
 * M2 — Keyed list reconciliation.
 * M4 — LIS-based move minimization (benchmark-driven).
 *
 * The list region owns a stretch of DOM ending at an explicit end anchor
 * (a comment node). Items are cached BY KEY: a reconcile with the same keys
 * reuses the exact same nodes and row entities — reordering MOVES nodes
 * (insertBefore on an attached node relocates it), never recreates them.
 * Focus, open <details>, playing video inside a row all survive moves.
 *
 * Algorithm per reconcile:
 *   pass 1 (forward):  reuse-or-create each entry; duplicate keys throw
 *   removals:          stale keys' nodes removed, entity subtrees unregistered
 *   pass 2 (reverse):  LIS-guided placement. Compute each new position's old
 *                      index, take the longest increasing subsequence (rows
 *                      already in correct relative order — never moved), and
 *                      insert/move only the rest before a running cursor.
 *                      A 2-row swap costs exactly 2 moves; an unchanged list
 *                      costs ZERO DOM operations.
 *
 * Why LIS matters (measured in M4): the earlier naive guard
 * (`nextSibling === cursor`) broke down across displaced regions — one moved
 * row made EVERY intermediate row fail the guard, so a swap of 2 rows in 1000
 * caused ~996 moves (~15ms). With LIS the same swap is 2 moves.
 *
 * Keys: default is item identity (reference for objects, value for primitives)
 * — Imba-style. A key function (item => item.id) survives re-fetched data.
 * Object identity keys get stable synthetic id segments (#1, #2, ...).
 */

import { getActiveEnvironment, unregisterSubtree, undirty, getEntity, type EntityId } from './kernel';
import { encodeListKey } from './list-keys';
import { HydrationMismatchError } from './hydration-error';
import { retainedRowNeedsSync } from './list-update';

export interface ListEntry {
  /** Detached or attached DOM nodes owned by this item (usually one root). */
  nodes: Node | readonly Node[];
  /** Entity ids created for this item — unregistered on removal. */
  entities: EntityId[];
  /**
   * M5.5: re-run the row's guarded update on every reconcile that REUSES
   * this entry. Rows read their item (a factory param), not module state,
   * so item-field mutations are otherwise invisible to the access table —
   * this is what keeps `{todo.title}` honest when an outside source (or a
   * handler) mutates a retained row's item. Guarded setters make a no-op
   * sync nearly free; DOM is only touched when data actually changed.
   */
  update?: () => void;
  /**
   * R10: component rows only — re-push the row's props box from the current
   * item on every reconcile that retains this entry. Item replacement AND
   * item-field mutation both reach the row entity (setProps shallow-compares,
   * so an unchanged item costs one comparison pass and nothing else).
   */
  updateProps?: (item: unknown, index: number) => void;
  /** Allocation-free rows may own mount lifecycle without an entity record. */
  dispose?: () => void;
}

export type KeyFn<T> = (item: T, index: number) => unknown;

/** Default key: the item itself (reference identity for objects). */
const identityKey = <T>(item: T): unknown => item;

export interface ListRegion<T> {
  /** appendOnly requires unchanged retained identities, positions, keys, and content; broad reasons still replay. */
  reconcile(items: readonly T[], structuralOnly?: boolean, appendOnly?: boolean): void;
  /** Re-sync one retained row through the region's O(1) key cache. */
  refreshKey(key: unknown): void;
  /** fixedPositions requires compiler proof of unchanged item identities, positions, and keys. */
  refreshIndices(items: readonly T[], indices: readonly number[], fixedPositions?: boolean): void;
  size(): number;
  /** Remove retained nodes and unregister every entity owned by the region. */
  dispose(): void;
}

/**
 * Longest increasing subsequence over `seq` (values; -1 = new item, skipped).
 * Returns the POSITIONS in seq that form one LIS — those rows stay put.
 * Verified cyclic shifts use O(n); other shapes use O(n log n) patience sorting.
 */
// M5.8: LIS working buffers are pooled module-wide (lisPositions calls no
// user code, so there is no reentrancy) — a 1000-row reorder used to
// allocate three fresh arrays per call.
const lisInLis: boolean[] = [];
const lisTails: number[] = [];
const lisPrev: number[] = [];

function lisPositions(seq: number[], start: number, end: number): boolean[] {
  const n = seq.length;
  const inLis = lisInLis;
  // A complete cyclic shift has two increasing runs. Prove it from the
  // evaluated old positions, then keep the longer run without sorting.
  // This proof accepts any producer; additions, gaps and duplicates fail it.
  const first = seq[start]!;
  const offset = first - start;
  const length = end - start;
  if (offset > 0 && offset < length) {
    let expected = first;
    let cyclic = true;
    for (let i = start; i < end; i++) {
      if (seq[i] !== expected) { cyclic = false; break; }
      if (++expected === end) expected = start;
    }
    if (cyclic) {
      inLis.length = n;
      const split = end - offset;
      // Equal runs use the smaller tails, matching patience sorting below.
      const keepFirst = length - offset > offset;
      for (let i = start; i < end; i++) inLis[i] = keepFirst ? i < split : i >= split;
      return inLis;
    }
  }
  const tails = lisTails; // tails[k] = position in seq of the smallest tail for length k+1
  const prev = lisPrev;
  inLis.length = n;
  prev.length = n;
  tails.length = 0;
  for (let i = start; i < end; i++) {
    inLis[i] = false;
    prev[i] = -1;
  }

  for (let i = start; i < end; i++) {
    const v = seq[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = i;
    if (lo > 0) prev[i] = tails[lo - 1]!;
  }

  let cur = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (cur >= 0) {
    inLis[cur] = true;
    cur = prev[cur]!;
  }
  return inLis;
}

export function createListRegion<T>(
  parent: Node,
  idPrefix: EntityId,
  create: (item: T, rowId: EntityId, index: number) => ListEntry,
  key: KeyFn<T> = identityKey,
  trackRowIds = true,
  indexSensitive = true,
): ListRegion<T> {
  // Hydration protocol (hydration-markers.md §2/§3): `mmd:l` owns the
  // complete row set. During adoption the existing pair remains the stable
  // insertion boundary; client creation emits an equivalent pair.
  const environment = getActiveEnvironment();
  const controller = environment.hydration;
  const adoptedRange = controller?.claimRange('l', idPrefix);
  const openAnchor =
    adoptedRange?.open ??
    environment.document.createComment(`mmd:l:${idPrefix}`);
  const endAnchor =
    (adoptedRange?.end as Comment | undefined) ??
    environment.document.createComment('/mmd');
  if (adoptedRange === undefined) {
    parent.appendChild(openAnchor);
    parent.appendChild(endAnchor);
  } else {
    controller!.recordFragmentRange(parent, adoptedRange);
  }
  let adopting = adoptedRange !== undefined;
  let nextAdoptedRow: Node | null =
    adoptedRange?.open.nextSibling ?? null;

  /**
   * M5.8: ONE map per region. The record carries everything the structural
   * path used to keep in three parallel maps (cache / keyToRowId /
   * prevIndex+nextIndex): pos is the row's position as of the last frame
   * (updated in pass 1), id its entity id, e its entry.
   */
  interface RowRec {
    e: ListEntry;
    id: EntityId | null;
    pos: number;
    key: unknown;
  }
  let cache = new Map<unknown, RowRec>();
  const syntheticIds = new Map<unknown, string>();
  let syntheticCounter = 0;
  // M5.7: previous frame's keys + entries in order, for the shape fast path.
  // Item identity alone does not prove authored keys are unchanged: key
  // functions can read mutable fields, getters or external state. Keep the
  // evaluated keys when that validation fails so the structural pass does
  // not evaluate those expressions a second time.
  let prevItems: T[] = [];
  const validatedKeys: unknown[] = [];
  // Ordered records keep the evaluated key, entry and optional id together.
  // Shape checks can compare keys directly, and removals never need to read
  // a key from a record that is no longer in the source list.
  let prevRows: RowRec[] = [];
  // M5.8: scratch buffers for the structural path, swapped with the live
  // ones after each reconcile — zero allocation in steady state.
  let nextMap = new Map<unknown, RowRec>();
  let nextRows: RowRec[] = [];
  const seq: number[] = []; // temp LIS sequence, reused

  /**
   * M5.7: sync a retained row with its (possibly mutated) item, then cancel
   * its pending dirty — the row just rendered with current state, so a
   * wildcard-dirtied entry in the commit batch would render it identically
   * a second time. Component rows (updateProps only, no update closure)
   * render their entity update directly in-place: the props box was just
   * re-pushed above, so the entity renders with current props in the same
   * pass instead of taking a second turn through the commit drain.
   */
  function syncRow(
    entry: ListEntry,
    item: T,
    rowId: EntityId | null,
    index: number,
  ): void {
    entry.updateProps?.(item, index); // R7/R10: refresh callback bindings
    if (entry.update !== undefined) {
      entry.update(); // M5.5: sync retained row with (possibly mutated) item
      if (rowId !== null) undirty(rowId); // M5.7: no double render
    } else if (rowId !== null) {
      // Component row: the entity renders in-place with the box just pushed
      // above (single pass), then its pending dirty is cancelled like any row.
      const e = getEntity(rowId);
      if (e) {
        e.render();
        undirty(rowId);
      }
    }
  }

  function cleanupEntry(entry: ListEntry, removeNodes = true): void {
    if (removeNodes) {
      const nodes = entry.nodes;
      if (Array.isArray(nodes)) {
        for (const node of nodes) node.parentNode?.removeChild(node);
      } else {
        (nodes as Node).parentNode?.removeChild(nodes as Node);
      }
    }
    for (const entity of entry.entities) unregisterSubtree(entity);
  }

  function syncRetained(
    entry: ListEntry,
    item: T,
    rowId: EntityId | null,
    index: number,
    previousIndex: number,
    structuralOnly: boolean,
  ): void {
    if (
      structuralOnly &&
      !retainedRowNeedsSync(
        prevItems[previousIndex] as T,
        item,
        previousIndex,
        index,
        indexSensitive,
      )
    ) {
      if (rowId !== null) undirty(rowId);
      return;
    }
    syncRow(entry, item, rowId, index);
  }

  function rowIdFor(k: unknown, encoded: string | null): EntityId {
    // Phase 0: type-tagged, escaped encoding — collision-free across
    // primitive types and safe inside the `Row[...]` id/marker structure.
    if (encoded !== null) return `${idPrefix}/Row[${encoded}]`;
    // Non-primitive keys: process-local synthetic ids (declared SSR
    // limitation — see list-keys.ts).
    let s = syntheticIds.get(k);
    if (s === undefined) {
      s = `#${++syntheticCounter}`;
      syntheticIds.set(k, s);
    }
    return `${idPrefix}/Row[${s}]`;
  }

  /**
   * Create one keyed row. The first hydration reconcile claims the row's
   * single-opening `mmd:w` extent and scopes DOM construction to its node
   * plan. Later reconciles use the ordinary document and fresh marker.
   */
  function createRow(
    item: T,
    keyValue: unknown,
    rowId: EntityId,
    index: number,
    encodedKey: string | null,
  ): ListEntry {
    if (adopting && encodedKey === null) {
      throw new HydrationMismatchError(
        idPrefix,
        'a hydration-stable primitive row key',
        `${typeof keyValue} key`,
      );
    }
    const adoptedRow = adopting
      ? controller!.claimRow(idPrefix, encodedKey!)
      : undefined;
    if (
      adoptedRow !== undefined &&
      adoptedRow.open !== nextAdoptedRow
    ) {
      const actual =
        nextAdoptedRow?.nodeType === 8
          ? `<!--${(nextAdoptedRow as Comment).data}-->`
          : 'a row at a different server position';
      throw new HydrationMismatchError(
        `${idPrefix}:${encodedKey}`,
        `<!--mmd:w:${idPrefix}:${encodedKey}--> in client key order`,
        actual,
      );
    }
    if (adoptedRow !== undefined) nextAdoptedRow = adoptedRow.end;
    if (adoptedRow !== undefined) controller!.pushRange(adoptedRow);

    let entry: ListEntry | undefined;
    let factoryFailed = false;
    let factoryError: unknown;
    try {
      entry = create(item, rowId, index);
    } catch (error) {
      factoryFailed = true;
      factoryError = error;
    }
    if (adoptedRow !== undefined) {
      try {
        controller!.popRange();
      } catch (error) {
        // A row-factory mismatch is more local and must remain primary.
        if (!factoryFailed) throw error;
      }
    }
    if (factoryFailed) throw factoryError;

    // Client-created rows already carry their compiler-defined node extent in
    // ListEntry.nodes, so a per-row hydration marker would only add another
    // allocation and another moved/removed DOM node. Server output and
    // hydration retain the marker protocol until markerless adoption is
    // separately proven end to end.
    if (encodedKey !== null && environment.mode !== 'client-create') {
      const marker =
        adoptedRow?.open ??
        getActiveEnvironment().document.createComment(
          `mmd:w:${idPrefix}:${encodedKey}`,
        );
      const nodes = entry!.nodes;
      entry!.nodes = Array.isArray(nodes)
        ? [marker, ...nodes]
        : [marker, nodes as Node];
    }
    return entry!;
  }

  function reconcile(
    items: readonly T[],
    structuralOnly = false,
    appendOnly = false,
  ): void {
    const container = endAnchor.parentNode ?? parent;
    const adoptingFrame = adopting;
    let evaluatedKeyCount = 0;
    validatedKeys.length = 0;
    // The compiler may prove that only fresh records are appended. Broad
    // reasons still replay retained rows; unproven callers keep validation.
    const provenAppend = appendOnly && structuralOnly && !adoptingFrame &&
      cache.size === prevItems.length;
    if (provenAppend && items.length === prevItems.length) return;
    // Same length AND every key identical at every position → no additions,
    // no removals, no reorder is possible: skip ALL map building and LIS.
    // This is the steady state of every list that only sees content edits.
    if (!adoptingFrame && items.length === prevItems.length && cache.size === prevItems.length) {
      let same = true;
      for (let i = 0; i < items.length; i++) {
        if (items[i] !== prevItems[i]) { same = false; break; }
      }
      if (same && key !== identityKey) {
        validatedKeys.length = items.length;
        for (let i = 0; i < items.length; i++) {
          const currentKey = key(items[i] as T, i);
          validatedKeys[i] = currentKey;
          evaluatedKeyCount = i + 1;
          const previousRow = prevRows[i];
          // Match Map's SameValueZero identity, including NaN and +/-0.
          if (previousRow === undefined || currentKey !== previousRow.key &&
              !(currentKey !== currentKey && previousRow.key !== previousRow.key)) same = false;
        }
      }
      // Authored key reads may themselves append or truncate the source.
      if (items.length !== prevItems.length) same = false;
      if (same) {
        validatedKeys.length = 0;
        for (let i = 0; i < items.length; i++) {
          syncRetained(
            prevRows[i]!.e,
            items[i] as T,
            prevRows[i]!.id,
            i,
            i,
            structuralOnly,
          );
        }
        return;
      }
    }

    // Append-only fast path. Validate every retained key against its cached
    // position before mutating anything, so mutable key fields still fall
    // through to the general reconciler. Once proven, keep the existing map
    // and ordered buffers in place, sync retained rows, and mount only the new
    // tail. This avoids transferring the full prefix into a scratch map and
    // running LIS for a sequence that is already ordered.
    if (
      !adoptingFrame &&
      (provenAppend || prevItems.length > 0) &&
      items.length > prevItems.length &&
      cache.size === prevItems.length
    ) {
      let appendOnly = true;
      for (let i = 0; !provenAppend && i < prevItems.length; i++) {
        const k = i < evaluatedKeyCount ? validatedKeys[i] : key(items[i] as T, i);
        validatedKeys[i] = k;
        if (i >= evaluatedKeyCount) evaluatedKeyCount = i + 1;
        const rec = cache.get(k);
        if (rec === undefined || rec.pos !== i) {
          appendOnly = false;
          break;
        }
      }
      if (appendOnly) {
        const appendedKeys: unknown[] = [];
        const seen = new Set<unknown>();
        for (let i = prevItems.length; i < items.length; i++) {
          const k = i < evaluatedKeyCount ? validatedKeys[i] : key(items[i] as T, i);
          if (cache.has(k) || seen.has(k)) {
            throw new Error(`[memo-dom] duplicate list key: ${String(k)}`);
          }
          appendedKeys.push(k);
          seen.add(k);
        }

        for (let i = 0; !provenAppend && i < prevItems.length; i++) {
          syncRetained(
            prevRows[i]!.e,
            items[i] as T,
            prevRows[i]!.id,
            i,
            i,
            structuralOnly,
          );
        }

        const fragment = environment.document.createDocumentFragment();
        const appended = nextRows;
        appended.length = 0;
        for (let offset = 0; offset < appendedKeys.length; offset++) {
          const i = prevItems.length + offset;
          const item = items[i] as T;
          const k = appendedKeys[offset];
          // Client rows without entity ids have no serialized key consumer.
          const encoded = trackRowIds || environment.mode !== 'client-create' ? encodeListKey(k) : null;
          const createId = trackRowIds ? rowIdFor(k, encoded) : idPrefix;
          const entry = createRow(item, k, createId, i, encoded);
          const id = trackRowIds ? createId : null;
          appended.push({ e: entry, id, pos: i, key: k });
          const nodes = entry.nodes;
          if (Array.isArray(nodes)) {
            for (const node of nodes) fragment.appendChild(node);
          } else {
            fragment.appendChild(nodes as Node);
          }
        }
        for (let offset = 0; offset < appended.length; offset++) {
          const pos = prevItems.length + offset;
          const rec = appended[offset]!;
          rec.pos = pos;
          cache.set(rec.key, rec);
          prevRows.push(rec);
        }
        (endAnchor.parentNode ?? parent).insertBefore(fragment, endAnchor);
        appended.length = 0;
        validatedKeys.length = 0;
        if (provenAppend) {
          for (let i = prevItems.length; i < items.length; i++) prevItems.push(items[i] as T);
        } else {
          prevItems = items.slice();
        }
        return;
      }
    }

    // Removal-only fast path. Prove that the next keys are a subsequence of
    // the prior order; then keep the live cache and skip both map transfer and
    // LIS. Index-dependent or changed keys naturally fail the proof and use
    // the general reconciler. A pure suffix is deleted as one DOM range.
    if (
      !adoptingFrame &&
      items.length > 0 &&
      items.length < prevItems.length &&
      cache.size === prevItems.length
    ) {
      const ordered = nextRows;
      ordered.length = items.length;
      let removalOnly = true;
      let lastOld = -1;
      let prefixOnly = true;
      for (let i = 0; i < items.length; i++) {
        const k = i < evaluatedKeyCount ? validatedKeys[i] : key(items[i] as T, i);
        validatedKeys[i] = k;
        if (i >= evaluatedKeyCount) evaluatedKeyCount = i + 1;
        // Removal subsequences usually continue at the next old position.
        // Gaps use the Map; contiguous survivors reuse the ordered record.
        const candidate = prevRows[lastOld + 1];
        const rec = candidate !== undefined && (candidate.key === k ||
          candidate.key !== candidate.key && k !== k) ? candidate : cache.get(k);
        if (rec === undefined || rec.pos <= lastOld) {
          removalOnly = false;
          break;
        }
        lastOld = rec.pos;
        prefixOnly &&= rec.pos === i;
        ordered[i] = rec;
      }
      if (removalOnly && items.length < prevItems.length) {
        // Key getters can shrink or grow the source while validating it.
        // Only the final surviving extent belongs to this removal frame.
        ordered.length = items.length;
        for (let i = 0; i < items.length; i++) {
          syncRetained(
            ordered[i]!.e,
            items[i] as T,
            ordered[i]!.id,
            i,
            ordered[i]!.pos,
            structuralOnly,
          );
        }

        if (prefixOnly) {
          for (let i = items.length; i < prevRows.length; i++) {
            prevRows[i]!.e.dispose?.();
          }
          const firstNodes = prevRows[items.length]!.e.nodes;
          const firstNode = Array.isArray(firstNodes)
            ? firstNodes[0]
            : firstNodes as Node;
          let removedAsRange = false;
          if (
            firstNode !== undefined &&
            firstNode.parentNode === container &&
            endAnchor.parentNode === container &&
            environment.document.createRange !== undefined
          ) {
            const range = environment.document.createRange!();
            range.setStartBefore(firstNode);
            range.setEndBefore(endAnchor);
            range.deleteContents();
            removedAsRange = true;
          }
          for (let i = items.length; i < prevRows.length; i++) {
            const rec = prevRows[i]!;
            cleanupEntry(rec.e, !removedAsRange);
            syntheticIds.delete(rec.key);
            cache.delete(rec.key);
          }
          prevRows.length = items.length;
          nextRows.length = 0;
          validatedKeys.length = 0;
          prevItems = items.slice();
          return;
        }

        let retainedIndex = 0;
        for (let oldIndex = 0; oldIndex < prevRows.length; oldIndex++) {
          const rec = prevRows[oldIndex]!;
          if (rec === ordered[retainedIndex]) {
            rec.pos = retainedIndex++;
            continue;
          }
          const entry = rec.e;
          entry.dispose?.();
          cleanupEntry(entry);
          syntheticIds.delete(rec.key);
          cache.delete(rec.key);
        }
        const priorRows = prevRows;
        prevRows = ordered;
        nextRows = priorRows;
        nextRows.length = 0;
        validatedKeys.length = 0;
        prevItems = items.slice();
        return;
      }
    }

    const old = cache;
    const oldWasEmpty = old.size === 0;
    // M5.8: build into the scratch buffers (swapped into `live` at the end)
    nextMap.clear();
    const next = nextMap;
    const ordered = nextRows;
    const n = items.length;
    ordered.length = n;
    seq.length = oldWasEmpty ? 0 : n;

    // ---- pass 1 (forward): reuse or create ----------------------------------
    // M5.6/M5.7: track the in-place fast path while fusing all per-row
    // bookkeeping into this one pass (no separate key array + loop).
    let hasNew = false;
    let reused = 0;
    let inOrder = true;
    let lastOld = -1;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const k = i < evaluatedKeyCount ? validatedKeys[i] : key(item, i);
      let rec: RowRec | undefined;
      // A matching cached key still present in the old map is unique so far.
      // Delete still happens before its update, as on the general path.
      // Consumed, displaced or new keys retain the general Map checks.
      const candidate = oldWasEmpty ? undefined : prevRows[i];
      if (candidate !== undefined && (candidate.key === k ||
          candidate.key !== candidate.key && k !== k) && old.delete(k)) {
        rec = candidate;
      } else {
        if (next.has(k)) {
          throw new Error(`[memo-dom] duplicate list key: ${String(k)}`);
        }
        rec = oldWasEmpty ? undefined : old.get(k);
        if (rec !== undefined) old.delete(k);
      }
      if (rec !== undefined) {
        reused++;
        const oldPos = rec.pos;
        seq[i] = oldPos;
        if (oldPos <= lastOld) inOrder = false;
        else lastOld = oldPos;
        rec.pos = i;
        syncRetained(rec.e, item, rec.id, i, oldPos, structuralOnly);
      } else {
        const encoded = trackRowIds || environment.mode !== 'client-create' ? encodeListKey(k) : null;
        const createId = trackRowIds ? rowIdFor(k, encoded) : idPrefix;
        const entry = createRow(item, k, createId, i, encoded);
        rec = {
          e: entry,
          id: trackRowIds ? createId : null,
          pos: i,
          key: k,
        };
        if (!oldWasEmpty) seq[i] = -1;
        hasNew = true;
      }
      next.set(k, rec);
      ordered[i] = rec;
    }
    validatedKeys.length = 0;
    if (adoptingFrame) {
      if (nextAdoptedRow !== adoptedRange!.end) {
        throw new HydrationMismatchError(
          idPrefix,
          'the list close after the final client row',
          'additional server row content',
        );
      }
      adopting = false;
    }

    // Complete replacement and clear own one contiguous DOM range. Delete
    // that range once instead of issuing one removeChild per retained row,
    // then append a replacement batch with one fragment insertion. With no
    // reused key there is also no old ordering to feed through LIS.
    if (!oldWasEmpty && reused === 0 && (n === 0 || hasNew)) {
      for (const [, rec] of old) rec.e.dispose?.();

      let removedAsRange = false;
      let firstOwned: Node | undefined;
      for (const rec of prevRows) {
        const nodes = rec.e.nodes;
        firstOwned = Array.isArray(nodes) ? nodes[0] : nodes as Node;
        if (firstOwned !== undefined) break;
      }
      if (
        firstOwned !== undefined &&
        firstOwned.parentNode === container &&
        endAnchor.parentNode === container &&
        getActiveEnvironment().document.createRange !== undefined
      ) {
        const range = getActiveEnvironment().document.createRange!();
        range.setStartBefore(firstOwned);
        range.setEndBefore(endAnchor);
        range.deleteContents();
        removedAsRange = true;
      }

      for (const [k, rec] of old) {
        cleanupEntry(rec.e, !removedAsRange);
        syntheticIds.delete(k);
      }
      old.clear();

      if (n !== 0) {
        const fragment = getActiveEnvironment().document.createDocumentFragment();
        for (let i = 0; i < ordered.length; i++) {
          const nodes = ordered[i]!.e.nodes;
          if (Array.isArray(nodes)) {
            for (const node of nodes) fragment.appendChild(node);
          } else {
            fragment.appendChild(nodes as Node);
          }
        }
        container.insertBefore(fragment, endAnchor);
      }

      cache = next; nextMap = old;
      const priorRows = prevRows; prevRows = ordered; nextRows = priorRows;
      nextRows.length = 0;
      prevItems = items.slice();
      return;
    }

    // Fresh mount after an empty frame: every row is new, so there is no old
    // ordering to analyze and no stale row to remove. Append the complete
    // batch in source order and skip LIS/pending-run bookkeeping entirely.
    if (oldWasEmpty && hasNew) {
      // Adopted nodes and row markers are already in server order. Moving
      // them through a fragment would preserve identity but violate the
      // read-only adoption contract.
      if (!adoptingFrame) {
        const fragment =
          getActiveEnvironment().document.createDocumentFragment();
        for (let i = 0; i < ordered.length; i++) {
          const nodes = ordered[i]!.e.nodes;
          if (Array.isArray(nodes)) {
            for (const node of nodes) fragment.appendChild(node);
          } else {
            fragment.appendChild(nodes as Node);
          }
        }
        container.insertBefore(fragment, endAnchor);
      }
      cache = next; nextMap = old;
      const priorRows = prevRows; prevRows = ordered; nextRows = priorRows;
      nextRows.length = 0;
      prevItems = items.slice();
      return;
    }

    // ---- fast path: pure content sync, zero structural work -----------------
    if (!hasNew && old.size === 0 && inOrder) {
      // M5.8: scratch buffers become live, live ones become next frame's
      // scratch (they are cleared/length-reset at the top of the slow path)
      cache = next; nextMap = old;
      const priorRows = prevRows; prevRows = ordered; nextRows = priorRows;
      // The former live buffers are scratch now. Truncate immediately rather
      // than retaining removed/replaced entries (and their detached DOM) until
      // the next structural reconciliation.
      nextRows.length = 0;
      prevItems = items.slice();
      return;
    }

    // ---- removals BEFORE placement (keeps placement math accurate) ----------
    for (const [k, rec] of old) {
      rec.e.dispose?.();
      cleanupEntry(rec.e);
      syntheticIds.delete(k);
    }
    // `old` becomes the next reconciliation's scratch map below. Iterating a
    // Map does not remove its entries, so without this clear a list that was
    // reconciled to empty retained every detached row (including DOM nodes and
    // handler closures) until another structural reconciliation or dispose.
    old.clear();

    // ---- pass 2 (reverse): LIS-guided placement ------------------------------
    // Rows in the LIS are already in correct relative order: skip them.
    // Everything else is inserted (new) or moved (displaced) — and CONTIGUOUS
    // runs of such entries are batched into a DocumentFragment inserted with
    // ONE DOM operation (fresh mount of 1000 rows = 1 insert, not 1000).
    // Unique retained keys make the unchanged old prefix/suffix permanent LIS
    // members. Their old positions bound every retained position in the middle,
    // even when additions or removals change the list length. Leave those ends
    // untouched and analyze/place only the changed interval. Row content and
    // authored keys have already replayed in their ordinary forward order.
    let start = 0;
    while (start < n && seq[start] === start) start++;
    let end = n;
    let oldEnd = prevItems.length;
    while (end > start && oldEnd > start && seq[end - 1] === oldEnd - 1) {
      end--;
      oldEnd--;
    }
    const inLis = lisPositions(seq, start, end);
    const suffix = ordered[end]?.e;
    let cursor: Node = suffix === undefined ? endAnchor
      : Array.isArray(suffix.nodes) ? suffix.nodes[0]! : suffix.nodes as Node;
    let pending: ListEntry[] | null = null; // run of entries awaiting insertion

    const flush = (): void => {
      if (pending === null) return;
      // A single Node can move directly. Arrays retain their iteration and
      // fragment semantics, including hydration-marker and multi-node extents.
      const singleNodes = pending.length === 1 ? pending[0]!.nodes : undefined;
      if (singleNodes !== undefined && !Array.isArray(singleNodes)) {
        container.insertBefore(singleNodes as Node, cursor);
        pending = null;
        return;
      }
      const frag = getActiveEnvironment().document.createDocumentFragment();
      for (let i = pending.length - 1; i >= 0; i--) {
        const nodes = singleNodes ?? pending[i]!.nodes;
        if (Array.isArray(nodes)) {
          for (const node of nodes) frag.appendChild(node);
        } else {
          frag.appendChild(nodes as Node);
        }
      }
      container.insertBefore(frag, cursor);
      pending = null;
    };

    for (let i = end - 1; i >= start; i--) {
      const entry = ordered[i]!.e;
      if (seq[i] === -1 || !inLis[i]) {
        // awaiting insertion — cursor stays on the last IN-PLACE node
        (pending ??= []).push(entry);
      } else {
        flush();
        cursor = Array.isArray(entry.nodes)
          ? entry.nodes[0]!
          : entry.nodes as Node;
      }
    }
    flush();

    // ---- bookkeeping for the next reconcile (M5.8: buffer swap) --------------
    cache = next; nextMap = old;
    const priorRows = prevRows; prevRows = ordered; nextRows = priorRows;
    nextRows.length = 0;
    prevItems = items.slice();
  }

  function refreshKey(k: unknown): void {
    const rec = cache.get(k);
    if (rec === undefined) return;
    syncRow(rec.e, prevItems[rec.pos] as T, rec.id, rec.pos);
  }

  function refreshIndices(items: readonly T[], indices: readonly number[], fixedPositions = false): void {
    // Initial/unmounted regions still reconcile. Unproven callers also validate
    // retained identities; the compiler alone can waive that O(n) scan.
    if (adopting || items.length !== prevItems.length ||
        !fixedPositions && items.some((item, index) => item !== prevItems[index])) {
      reconcile(items);
      return;
    }
    for (const index of indices) {
      const rec = prevRows[index];
      if (rec !== undefined) syncRow(rec.e, items[index] as T, rec.id, index);
    }
  }

  function dispose(): void {
    // Failed append factories can leave completed rows only in the ordered
    // scratch buffer. Removal probes also put live records there, so skip
    // entries already owned by either map to avoid disposing them twice.
    for (const rec of nextRows) {
      if (rec !== undefined && cache.get(rec.key) !== rec && nextMap.get(rec.key) !== rec) {
        rec.e.dispose?.();
        cleanupEntry(rec.e);
        syntheticIds.delete(rec.key);
      }
    }
    for (const [key, rec] of cache) {
      rec.e.dispose?.();
      cleanupEntry(rec.e);
      syntheticIds.delete(key);
    }
    // During a failed general frame, consumed and newly created records are
    // in nextMap, disjoint from the unconsumed records left in cache.
    for (const [key, rec] of nextMap) {
      rec.e.dispose?.();
      cleanupEntry(rec.e);
      syntheticIds.delete(key);
    }
    cache.clear();
    nextMap.clear();
    prevItems = [];
    validatedKeys.length = 0;
    prevRows.length = 0;
    nextRows.length = 0;
    endAnchor.parentNode?.removeChild(endAnchor);
    openAnchor.parentNode?.removeChild(openAnchor);
  }

  return {
    reconcile,
    refreshKey,
    refreshIndices,
    size: () => cache.size,
    dispose,
  };
}

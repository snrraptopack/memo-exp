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

import { unregisterSubtree, undirty, type EntityId } from './kernel';

export interface ListEntry {
  /** Detached or attached DOM nodes owned by this item (usually one root). */
  nodes: Node[];
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
  updateProps?: (item: unknown) => void;
}

export type KeyFn<T> = (item: T) => unknown;

/** Default key: the item itself (reference identity for objects). */
const identityKey = <T>(item: T): unknown => item;

export interface ListRegion<T> {
  reconcile(items: readonly T[]): void;
  size(): number;
}

/**
 * Longest increasing subsequence over `seq` (values; -1 = new item, skipped).
 * Returns the POSITIONS in seq that form one LIS — those rows stay put.
 * Patience sorting, O(n log n).
 */
function lisPositions(seq: number[]): boolean[] {
  const inLis = new Array<boolean>(seq.length).fill(false);
  const tails: number[] = []; // tails[k] = position in seq of the smallest tail for length k+1
  const prev = new Array<number>(seq.length).fill(-1);

  for (let i = 0; i < seq.length; i++) {
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
  create: (item: T, rowId: EntityId) => ListEntry,
  key: KeyFn<T> = identityKey,
): ListRegion<T> {
  const endAnchor = document.createComment(`list:${idPrefix}`);
  parent.appendChild(endAnchor);

  let cache = new Map<unknown, ListEntry>();
  let prevIndex = new Map<unknown, number>(); // key -> position in the PREVIOUS order
  const syntheticIds = new Map<unknown, string>();
  const keyToRowId = new Map<unknown, EntityId>(); // M5.7: avoid re-concat per frame
  let syntheticCounter = 0;
  // M5.7: previous frame's keys + entries in order, for the shape fast path.
  let prevKeys: unknown[] = [];
  let prevEntries: ListEntry[] = [];
  let prevRowIds: EntityId[] = [];

  /**
   * M5.7: sync a retained row with its (possibly mutated) item, then cancel
   * its pending dirty — the row just rendered with current state, so a
   * wildcard-dirtied entry in the commit batch would render it identically
   * a second time. Component rows (updateProps only, no update closure)
   * keep their dirty: their render IS the props propagation.
   */
  function syncRow(entry: ListEntry, item: T, rowId: EntityId): void {
    entry.updateProps?.(item); // R10: re-push the props box (component rows)
    if (entry.update !== undefined) {
      entry.update(); // M5.5: sync retained row with (possibly mutated) item
      undirty(rowId); // M5.7: no double render
    }
  }

  function rowIdFor(k: unknown): EntityId {
    const t = typeof k;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
      return `${idPrefix}/Row[${String(k)}]`;
    }
    let s = syntheticIds.get(k);
    if (s === undefined) {
      s = `#${++syntheticCounter}`;
      syntheticIds.set(k, s);
    }
    return `${idPrefix}/Row[${s}]`;
  }

  function reconcile(items: readonly T[]): void {
    // ---- M5.7 shape fast path ---------------------------------------------
    // Same length AND every key identical at every position → no additions,
    // no removals, no reorder is possible: skip ALL map building and LIS.
    // This is the steady state of every list that only sees content edits.
    if (items.length === prevKeys.length) {
      let same = true;
      for (let i = 0; i < items.length; i++) {
        if (key(items[i] as T) !== prevKeys[i]) { same = false; break; }
      }
      if (same) {
        for (let i = 0; i < items.length; i++) {
          syncRow(prevEntries[i]!, items[i] as T, prevRowIds[i]!);
        }
        return;
      }
    }

    const old = cache;
    const next = new Map<unknown, ListEntry>();
    const keys: unknown[] = new Array(items.length);
    const rowIds: EntityId[] = new Array(items.length);

    // ---- pass 1 (forward): reuse or create ----------------------------------
    // M5.6: nextIndex is fused into this pass (no separate key array + loop),
    // and we track the in-place fast path: no additions, no removals, and
    // retained rows already in order — then placement is skipped entirely
    // (this is the steady-state "content changed, structure didn't" case:
    // renames, toggles, partial updates).
    const ordered: ListEntry[] = new Array(items.length);
    const seq: number[] = new Array(items.length); // old index per new position (-1 = new)
    const nextIndex = new Map<unknown, number>();
    let hasNew = false;
    let inOrder = true;
    let lastOld = -1;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      const k = key(item);
      if (next.has(k)) {
        throw new Error(`[memo-dom] duplicate list key: ${String(k)}`);
      }
      let entry = old.get(k);
      let rowId: EntityId;
      if (entry !== undefined) {
        old.delete(k);
        rowId = keyToRowId.get(k)!;
        const oi = prevIndex.get(k) ?? -1;
        seq[i] = oi;
        if (oi <= lastOld) inOrder = false;
        else lastOld = oi;
        syncRow(entry, item, rowId);
      } else {
        rowId = rowIdFor(k);
        keyToRowId.set(k, rowId);
        entry = create(item, rowId);
        seq[i] = -1;
        hasNew = true;
      }
      next.set(k, entry);
      nextIndex.set(k, i);
      ordered[i] = entry;
      keys[i] = k;
      rowIds[i] = rowId;
    }

    // ---- fast path: pure content sync, zero structural work -----------------
    if (!hasNew && old.size === 0 && inOrder) {
      prevIndex = nextIndex;
      cache = next;
      prevKeys = keys;
      prevEntries = ordered;
      prevRowIds = rowIds;
      return;
    }

    // ---- removals BEFORE placement (keeps placement math accurate) ----------
    for (const [k, entry] of old) {
      for (const n of entry.nodes) n.parentNode?.removeChild(n);
      for (const eid of entry.entities) unregisterSubtree(eid);
      syntheticIds.delete(k);
      keyToRowId.delete(k);
    }

    // ---- pass 2 (reverse): LIS-guided placement ------------------------------
    // Rows in the LIS are already in correct relative order: skip them.
    // Everything else is inserted (new) or moved (displaced) — and CONTIGUOUS
    // runs of such entries are batched into a DocumentFragment inserted with
    // ONE DOM operation (fresh mount of 1000 rows = 1 insert, not 1000).
    const inLis = lisPositions(seq);
    let cursor: Node = endAnchor;
    let pending: ListEntry[] | null = null; // run of entries awaiting insertion

    const flush = (): void => {
      if (pending === null) return;
      const frag = document.createDocumentFragment();
      for (let i = pending.length - 1; i >= 0; i--) {
        for (const n of pending[i]!.nodes) frag.appendChild(n);
      }
      parent.insertBefore(frag, cursor);
      pending = null;
    };

    for (let i = ordered.length - 1; i >= 0; i--) {
      const entry = ordered[i]!;
      if (seq[i] === -1 || !inLis[i]) {
        // awaiting insertion — cursor stays on the last IN-PLACE node
        (pending ??= []).push(entry);
      } else {
        flush();
        cursor = entry.nodes[0]!;
      }
    }
    flush();

    // ---- bookkeeping for the next reconcile ----------------------------------
    prevIndex = nextIndex;
    cache = next;
    prevKeys = keys;
    prevEntries = ordered;
    prevRowIds = rowIds;
  }

  return {
    reconcile,
    size: () => cache.size,
  };
}

/**
 * @file kernel.ts
 * M0 — Runtime kernel of the Analyzed Memoized DOM.
 *
 * The kernel owns exactly four things (see memoized-dom-paradigm.md §5–§6):
 *   1. The entity registry   — Map<id, Entity>, O(1) lookup by hierarchical id
 *   2. The dirty set         — Set<id>, dedupes any number of triggers into one render
 *   3. The frame scheduler   — batches all dirty marks into one commit per frame
 *   4. The commit cycle      — re-renders exactly the dirty set, parent-before-child
 *
 * It knows NOTHING about components, state, or events. Those are compiler
 * concerns layered on top. Keep this file dependency-free and tiny.
 *
 * M4 hardening (benchmark-driven):
 *   - Entity carries `children` + precomputed `depth`: subtree teardown is
 *     O(subtree) — was O(registry) per entity, i.e. O(n^2) on mass removal
 *     (clear-10k took 1510ms before this fix)
 *   - commit sorts NUMERIC depths, not string paths
 *   - registeredIds() returns a cached array, rebuilt only on register/unregister
 *
 * INVARIANT (the M5 compiler guarantees this): parents register BEFORE their
 * children, so child links exist. Violations don't corrupt rendering — they
 * only orphan children from subtree teardown.
 */

export type EntityId = string;

/**
 * A mounted component instance.
 * `render` is the UPDATE branch only — the creation branch ran once at mount
 * and cached its nodes in a closure (see examples/counter.ts).
 * `depth` and `children` are managed by register(); callers only provide
 * id, parent, render.
 */
export interface Entity {
  id: EntityId;
  parent: EntityId | null;
  render: () => void;
  depth?: number;
  children?: Set<EntityId>;
}

const registry = new Map<EntityId, Entity>();
const dirtySet = new Set<EntityId>();

// ---------------------------------------------------------------------------
// Scheduler — injectable, because the commit timing policy is not universal:
//   browser  → requestAnimationFrame (align with paint)
//   tests    → synchronous or manual pump
//   SSR      → never schedules at all
// ---------------------------------------------------------------------------
type Scheduler = (fn: () => void) => void;

const defaultScheduler: Scheduler =
  typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(fn)
    : (fn) => setTimeout(fn, 0);

let scheduleFn: Scheduler = defaultScheduler;

/** Swap the scheduling policy (tests, SSR, custom frame loops). */
export function setScheduler(fn: Scheduler): void {
  scheduleFn = fn;
}

/** Restore the environment default (rAF / setTimeout). */
export function resetScheduler(): void {
  scheduleFn = defaultScheduler;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
/** Depth from the id path itself — order-independent, no parent lookup. */
function depthOf(id: EntityId): number {
  let d = 0;
  for (let i = 0; i < id.length; i++) {
    if (id.charCodeAt(i) === 47 /* '/' */) d++;
  }
  return d;
}

/** Cached id array for the access resolver — rebuilt on registry mutation. */
let idsCache: EntityId[] | null = null;

/**
 * M5.6: monotonic registry generation, bumped on every register/unregister.
 * The access resolver caches write-set resolutions against it — a hit is
 * only valid while the entity set is unchanged.
 */
let generation = 0;

/** Current registry generation (see above). Introspection/resolver only. */
export function registryGeneration(): number {
  return generation;
}

/**
 * M5.6: registry-change listeners — push-based notification so the access
 * resolver can keep wildcard expansions incrementally updated instead of
 * re-matching every pattern against every id on every commit. Listeners
 * run synchronously; they must be cheap (a few regex tests).
 */
type RegistryListener = (id: EntityId, kind: 'add' | 'remove') => void;
const registryListeners: RegistryListener[] = [];

export function onRegistryChange(fn: RegistryListener): void {
  registryListeners.push(fn);
}

function notifyRegistry(id: EntityId, kind: 'add' | 'remove'): void {
  for (const fn of registryListeners) fn(id, kind);
}

export function register(entity: Entity): void {
  const parent = entity.parent !== null ? registry.get(entity.parent) : undefined;
  // an explicit depth wins (R13 computeds register at -1: recompute BEFORE
  // any reader renders); else derive from the parent — string scan fallback
  entity.depth =
    entity.depth ??
    (parent && parent.depth !== undefined ? parent.depth + 1 : depthOf(entity.id));
  registry.set(entity.id, entity);

  if (parent) {
    (parent.children ??= new Set()).add(entity.id);
  }

  idsCache = null;
  generation++;
  notifyRegistry(entity.id, 'add');
}

/**
 * Unregister an entity and ALL its descendants — O(subtree), not O(registry).
 * Walks the children links; also detaches from the parent's children set.
 */
export function unregisterSubtree(id: EntityId): void {
  const root = registry.get(id);
  if (!root) return;

  if (root.parent !== null) {
    registry.get(root.parent)?.children?.delete(id);
  }

  const stack: EntityId[] = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const e = registry.get(cur);
    if (!e) continue;
    if (e.children) {
      for (const c of e.children) stack.push(c);
    }
    registry.delete(cur);
    dirtySet.delete(cur);
    notifyRegistry(cur, 'remove');
  }

  idsCache = null;
  generation++;
}

/** Single-id unregister takes its subtree with it — same thing. */
export function unregister(id: EntityId): void {
  unregisterSubtree(id);
}

export function has(id: EntityId): boolean {
  return registry.has(id);
}

export function getEntity(id: EntityId): Entity | undefined {
  return registry.get(id);
}

/**
 * Live entity ids for the access-table resolver. Cached — the array is
 * rebuilt only when the registry mutates, so per-event cost is zero.
 * Callers MUST NOT mutate the returned array.
 */
export function registeredIds(): readonly EntityId[] {
  idsCache ??= [...registry.keys()];
  return idsCache;
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------
/**
 * Mark one entity dirty and schedule a commit.
 *
 * Dead letters (spec §9.7): marking an unmounted id is a silent no-op.
 * Dev builds may warn here later.
 */
export function markDirty(id: EntityId): void {
  if (!registry.has(id)) return;
  dirtySet.add(id);
  scheduleCommit();
}

/**
 * Cancel a pending dirty (M5.7): a list row that just rendered through the
 * reconcile resync (M5.5 entry.update) must not render a second, identical
 * time when the commit batch reaches it. Only removes a PENDING entry —
 * if the row is re-dirtied later (cascade), it renders again as usual.
 */
export function undirty(id: EntityId): void {
  // size gate first: rows are undirtied on EVERY reconcile resync (M5.7)
  // while almost never actually pending — skip the string hash lookup then
  if (dirtySet.size !== 0) dirtySet.delete(id);
}

/**
 * Mark an entity and ALL its descendants dirty — the "root commit" fallback
 * for opaque state (spec §4.5 fallback rule). Equivalent to Imba re-rendering
 * from the mounted root: correct under any circumstance, just not scoped.
 *
 * NOTE: prefix scan (rare fallback path); teardown uses the children links.
 */
export function markDirtySubtree(id: EntityId): void {
  const prefix = id + '/';
  let marked = false;
  for (const key of registry.keys()) {
    if (key === id || key.startsWith(prefix)) {
      dirtySet.add(key);
      marked = true;
    }
  }
  if (marked) scheduleCommit();
}

let scheduled = false;
let inCommit = false;

function scheduleCommit(): void {
  if (scheduled || inCommit) return; // dedupe: 1000 marks → 1 frame
  scheduled = true;
  scheduleFn(commit);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------
/**
 * Run commit passes until the dirty set is empty: re-render the dirty set,
 * parents before children (numeric depth sort — cheap even for 10k dirty
 * entities). R10: renders may dirty further ids (props re-push); those join
 * the SAME commit via the drain loop — no one-frame lag for prop flow.
 *
 * PUBLIC API (M5.6): this is the "flush now" entry point — the memo-dom
 * equivalent of React's flushSync / Svelte 5's flushSync. With the default
 * frame scheduler, `markDirty`/`commitWrites` only SCHEDULE a commit; call
 * `commit()` to run it synchronously (tests, boundary integrations where a
 * host requires synchronous DOM, e.g. the dom-reconciler-bench contract).
 * Prefer `setScheduler(fn => fn())` when the WHOLE app should be sync.
 */
export function commit(): void {
  scheduled = false;
  if (inCommit) return; // reentrancy: the running drain picks up new marks
  inCommit = true;
  try {
    // R10: drain loop — renders may mark further ids (setProps pushing props
    // to children, update-driven invalidation). Depth-sorted batches keep
    // parent-before-child within and across passes. A bound guards cycles.
    for (let pass = 0; pass < 100 && dirtySet.size > 0; pass++) {
      // M5.7: keep ids IN the dirty set until the moment they render —
      // a render that runs earlier in this batch (parent list reconcile →
      // M5.5 row resync) may cancel a row's pending render via undirty().
      const batch: Entity[] = [];
      for (const id of dirtySet) {
        const e = registry.get(id);
        if (e) batch.push(e);
        else dirtySet.delete(id); // dead letter: dirtied, then unregistered
      }

      batch.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

      for (const e of batch) {
        if (dirtySet.delete(e.id)) e.render();
      }
      // ids dirtied DURING renders (cascade) stay in the set → next pass
    }
    if (dirtySet.size > 0) {
      throw new Error(
        '[memo-dom] commit cascade exceeded 100 passes — an update is dirtying its own readers (cycle)',
      );
    }
  } finally {
    inCommit = false;
  }
}

// ---------------------------------------------------------------------------
// Introspection (tests / devtools only — not part of the paradigm surface)
// ---------------------------------------------------------------------------
export function _internals(): {
  registry: ReadonlyMap<EntityId, Entity>;
  dirtySet: ReadonlySet<EntityId>;
} {
  return { registry, dirtySet };
}

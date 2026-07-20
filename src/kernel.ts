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

export function register(entity: Entity): void {
  const parent = entity.parent !== null ? registry.get(entity.parent) : undefined;
  // depth from the parent's number when possible — string scan is the fallback
  entity.depth =
  parent && parent.depth !== undefined ? parent.depth + 1 : depthOf(entity.id);
  registry.set(entity.id, entity);

  if (parent) {
    (parent.children ??= new Set()).add(entity.id);
  }

  idsCache = null;
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
  }

  idsCache = null;
}

/** Single-id unregister takes its subtree with it — same thing. */
export function unregister(id: EntityId): void {
  unregisterSubtree(id);
}

export function has(id: EntityId): boolean {
  return registry.has(id);
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

function scheduleCommit(): void {
  if (scheduled) return; // dedupe: 1000 marks → 1 frame
  scheduled = true;
  scheduleFn(commit);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------
/**
 * Run one commit pass: re-render the dirty set, parents before children
 * (numeric depth sort — cheap even for 10k dirty entities).
 *
 * NOTE (deferred design point): if a render() marks NEW ids dirty during the
 * pass, they schedule the next frame, not this one (no cascading commit yet).
 */
export function commit(): void {
  scheduled = false;
  if (dirtySet.size === 0) return;

  const batch: Entity[] = [];
  for (const id of dirtySet) {
    const e = registry.get(id);
    if (e) batch.push(e);
  }
  dirtySet.clear();

  batch.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

  for (const e of batch) e.render();
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

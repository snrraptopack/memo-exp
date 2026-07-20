/**
 * @file access.ts
 * M3 — The static access table: compile-time read/write knowledge.
 *
 * In the real pipeline (M5) the COMPILER emits this table per app by analyzing
 * component bodies. In the bootstrap we hand-write it — we are the compiler.
 *
 * readers: variable name -> entity id patterns that READ it.
 *   - exact id:     'App/Header/Badge'
 *   - '*' wildcard: 'App/SelectList/Row[*]'  ('*' matches within one segment)
 *
 * opaque: variables the analysis cannot prove (dynamic member access, state
 *   escaping to third-party code). Writing an opaque variable falls back to a
 *   root-subtree commit — exactly Imba's behavior. Never incorrect, just not
 *   scoped (spec §4.5 fallback rule).
 *
 * HONEST LIMITATION: patterns over-approximate. 'Row[*]' dirties ALL live rows
 * even when only two could visibly change; the value-cached setters absorb
 * that slack (guarded writes no-op). The sharpening path — patterns
 * parametrized by event payload, e.g. 'Row[{e.payload.id}]' — is a known
 * follow-up, deferred until M4 benchmarks say whether it matters.
 */

import { onRegistryChange, registeredIds, type EntityId } from './kernel';

export interface AccessTable {
  readers: Record<string, string[]>;
  opaque?: string[];
}

let rootId: EntityId = '';
let exactReaders = new Map<string, EntityId[]>();
let wildReaders = new Map<string, RegExp[]>();
let opaqueVars = new Set<string>();

/**
 * M5.6 — precompiled, push-maintained matcher state.
 *
 * resolveWrites used to pay, PER COMMIT: rebuild the table-key union, then
 * scan every live id through every matched wildcard regex (O(patterns × ids)
 * — ~400 regex tests per commit at 100 rows; a generation-keyed cache didn't
 * help because row add/remove bumps the generation on exactly those steps).
 * Now:
 *   - `matchKeys` per write key is cached permanently (registry-independent);
 *   - wildcard expansions (`wildMatched`) are maintained INCREMENTALLY: a
 *     kernel registry listener tests only the added/removed id against the
 *     patterns — O(patterns) per registry change, O(1) per commit;
 *   - full resolutions are cached against `resVersion`, bumped by installs
 *     and by any incremental expansion change.
 * Cached arrays are shared; callers must not mutate them.
 */
let allKeysCache: string[] = [];
let wildMatched = new Map<string, Set<EntityId>>();
let resVersion = 0;
const matchKeysCache = new Map<string, string[]>();
const resolutionCache = new Map<string, { v: number; result: EntityId[] }>();

/** Full (re)build of wildcard expansions against the live registry. */
function rebuildMatched(): void {
  wildMatched = new Map();
  const live = registeredIds();
  for (const [k, patterns] of wildReaders) {
    const set = new Set<EntityId>();
    for (const regex of patterns) {
      for (const id of live) {
        if (regex.test(id)) set.add(id);
      }
    }
    wildMatched.set(k, set);
  }
}

// Incremental expansion maintenance: test only the changed id.
onRegistryChange((id, kind) => {
  if (wildReaders.size === 0) return;
  let touched = false;
  if (kind === 'add') {
    for (const [k, patterns] of wildReaders) {
      const set = wildMatched.get(k);
      if (!set) continue;
      for (const regex of patterns) {
        if (regex.test(id)) {
          set.add(id);
          touched = true;
          break;
        }
      }
    }
  } else {
    for (const set of wildMatched.values()) {
      if (set.delete(id)) touched = true;
    }
  }
  if (touched) resVersion++;
});

/** '*' matches any run of non-separator characters within one id segment. */
function compilePattern(raw: string): RegExp | null {
  if (!raw.includes('*')) return null;
  const escaped = raw
    .split('*')
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Install a table fragment. Fragments MERGE app-wide (spec §4.6): every
 * compiled module installs its own fragment at init, and readers from all
 * of them must stay live — a write in module A can target a component
 * declared in module B. Re-installing the same fragment is idempotent.
 */
export function installAccessTable(table: AccessTable, root: EntityId): void {
  rootId = root;
  const seen = new Set<string>();

  for (const [variable, patterns] of Object.entries(table.readers)) {
    for (const p of patterns) {
      const dedupeKey = `${variable}${p}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const regex = compilePattern(p);
      if (regex === null) {
        const list = exactReaders.get(variable) ?? [];
        if (!list.includes(p)) list.push(p);
        exactReaders.set(variable, list);
      } else {
        const list = wildReaders.get(variable) ?? [];
        if (!list.some((r) => r.source === regex.source)) list.push(regex);
        wildReaders.set(variable, list);
      }
    }
  }
  for (const v of table.opaque ?? []) opaqueVars.add(v);

  // M5.6: rebuild the precompiled matcher state
  allKeysCache = [...new Set([...exactReaders.keys(), ...wildReaders.keys()])];
  matchKeysCache.clear();
  resolutionCache.clear();
  rebuildMatched();
  resVersion++;
}

/** Clear every installed fragment — test isolation, not app code. */
export function resetAccessTable(): void {
  rootId = '';
  exactReaders = new Map();
  wildReaders = new Map();
  opaqueVars = new Set();
  allKeysCache = [];
  wildMatched = new Map();
  matchKeysCache.clear();
  resolutionCache.clear();
  resVersion++;
}

export function isOpaque(variable: string): boolean {
  return opaqueVars.has(variable);
}

export function getRootId(): EntityId {
  return rootId;
}

/**
 * Resolve written variables to the entity ids that must be dirtied.
 * Exact readers are returned as-is (markDirty no-ops dead letters).
 * Wildcards are expanded by the caller against live registry ids.
 *
 * Path granularity (M5.3): a write matches a read key when their dotted
 * paths are equal OR one is a segment-wise prefix of the other — writing
 * 'store.items' invalidates readers of 'store.items.length' (descendant)
 * and of 'store' (ancestor). Segment boundaries prevent 'items' ↔ 'items1'.
 *
 * Returns 'root-subtree' when any write is opaque — the Imba fallback.
 */
export function resolveWrites(
  writes: readonly string[],
  _liveIds: readonly EntityId[],
): EntityId[] | 'root-subtree' {
  if (writes.some(isOpaque)) return 'root-subtree';

  // M5.6: full-resolution cache, valid until any expansion changes
  const cacheKey = writes.length === 1 ? (writes[0] as string) : writes.join(' ');
  const hit = resolutionCache.get(cacheKey);
  if (hit !== undefined && hit.v === resVersion) return hit.result;

  const out = new Set<EntityId>();

  // matchKeys per write key: registry-independent, cached permanently
  const matchKeys = new Set<string>();
  for (const w of writes) {
    let keys = matchKeysCache.get(w);
    if (keys === undefined) {
      keys = [];
      for (const k of allKeysCache) {
        if (k === w || k.startsWith(`${w}.`) || w.startsWith(`${k}.`)) {
          keys.push(k);
        }
      }
      matchKeysCache.set(w, keys);
    }
    for (const k of keys) matchKeys.add(k);
  }

  for (const k of matchKeys) {
    for (const id of exactReaders.get(k) ?? []) out.add(id);
    for (const id of wildMatched.get(k) ?? []) out.add(id);
  }

  const result = [...out];
  resolutionCache.set(cacheKey, { v: resVersion, result });
  return result;
}

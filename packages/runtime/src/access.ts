/**
 * access.ts — M3 — The static access table: compile-time read/write knowledge.
 *
 * In the real pipeline (M5) the COMPILER emits this table per app by analyzing
 * component bodies. In the bootstrap we hand-write it — we are the compiler.
 *
 * readers: canonical module-qualified state key -> entity id patterns that
 * READ it (`./state.ts#store.selectedId`).
 *   - exact id:     'App/Header/Badge'
 *   - '*' wildcard: 'App/SelectList/Row[*]'  ('*' matches within one segment)
 *
 * opaque: variables the analysis cannot prove (dynamic member access, state
 *   escaping to third-party code). Writing an opaque variable falls back to a
 *   root-subtree commit — exactly Imba's behavior. Never incorrect, just not
 *   scoped (spec §4.5 fallback rule).
 *
 * HONEST LIMITATION: ordinary 'Row[*]' readers over-approximate and dirty all
 * matching live rows. Parametrized payload patterns can narrow this when the
 * compiler has a precise target; otherwise guarded writes absorb the slack.
 *
 * SSR Slice 1.1b — all resolver state lives on the active application
 * runtime. Installed fragments and their derived matcher caches are
 * request-scoped: two concurrent server renders maintain completely separate
 * tables, and a runtime's registry listener mutates only its own expansions.
 */

import {
  getExtensionStore,
  onRegistryChange,
  onRuntimeCreated,
  registeredIds,
  type EntityId,
} from './kernel';
import { encodeListKey } from './list-keys';

export interface AccessTable {
  readers: Record<string, string[]>;
  opaque?: string[];
  /** L2 precision patterns, interpolated from commitWrites(..., payload). */
  params?: Record<string, readonly { pattern: string }[]>;
}

/**
 * Resolver state for one application runtime.
 */
interface AccessResolverState {
  rootId: EntityId;
  exactReaders: Map<string, EntityId[]>;
  wildReaders: Map<string, RegExp[]>;
  paramReaders: Map<string, string[]>;
  opaqueVars: Set<string>;
  readonly fragments: Map<string, { table: AccessTable; root: EntityId }>;
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
   */
  allKeysCache: string[];
  wildMatched: Map<string, Set<EntityId>>;
  resVersion: number;
  readonly matchKeysCache: Map<string, string[]>;
  readonly resolutionCache: Map<string, { v: number; result: EntityId[] }>;
}

function createAccessResolverState(): AccessResolverState {
  return {
    rootId: '',
    exactReaders: new Map(),
    wildReaders: new Map(),
    paramReaders: new Map(),
    opaqueVars: new Set(),
    fragments: new Map(),
    allKeysCache: [],
    wildMatched: new Map(),
    resVersion: 0,
    matchKeysCache: new Map(),
    resolutionCache: new Map(),
  };
}

function resolver(): AccessResolverState {
  return getExtensionStore('access', createAccessResolverState);
}

/** Full (re)build of wildcard expansions against the live registry. */
function rebuildMatched(
  s: AccessResolverState,
  live: Iterable<EntityId> = registeredIds(),
): void {
  s.wildMatched = new Map();
  for (const [k, patterns] of s.wildReaders) {
    const set = new Set<EntityId>();
    for (const regex of patterns) {
      for (const id of live) {
        if (regex.test(id)) set.add(id);
      }
    }
    s.wildMatched.set(k, set);
  }
}
// Incremental expansion maintenance: test only the changed id. Registry
// events fire while the emitting runtime is active, so this touches only the
// active runtime's own expansions.
onRegistryChange((id, kind) => {
  const s = resolver();
  if (s.wildReaders.size === 0) return;
  let touched = false;
  if (kind === 'add') {
    for (const [k, patterns] of s.wildReaders) {
      const set = s.wildMatched.get(k);
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
    for (const set of s.wildMatched.values()) {
      if (set.delete(id)) touched = true;
    }
  }
  if (touched) s.resVersion++;
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
function rebuildTables(
  s: AccessResolverState = resolver(),
  live: Iterable<EntityId> = registeredIds(),
): void {
  s.rootId = '';
  s.exactReaders = new Map();
  s.wildReaders = new Map();
  s.paramReaders = new Map();
  s.opaqueVars = new Set();
  for (const { table, root } of s.fragments.values()) {
    s.rootId = root;
    for (const [variable, patterns] of Object.entries(table.readers)) {
      for (const pattern of patterns) {
        const regex = compilePattern(pattern);
        if (regex === null) {
          const list = s.exactReaders.get(variable) ?? [];
          if (!list.includes(pattern)) list.push(pattern);
          s.exactReaders.set(variable, list);
        } else {
          const list = s.wildReaders.get(variable) ?? [];
          if (!list.some((entry) => entry.source === regex.source)) {
            list.push(regex);
          }
          s.wildReaders.set(variable, list);
        }
      }
    }
    for (const [variable, entries] of Object.entries(table.params ?? {})) {
      const patterns = s.paramReaders.get(variable) ?? [];
      for (const entry of entries) {
        if (!patterns.includes(entry.pattern)) patterns.push(entry.pattern);
      }
      s.paramReaders.set(variable, patterns);
    }
    for (const variable of table.opaque ?? []) s.opaqueVars.add(variable);
  }
  s.allKeysCache = [
    ...new Set([...s.exactReaders.keys(), ...s.wildReaders.keys()]),
  ];
  s.matchKeysCache.clear();
  s.resolutionCache.clear();
  rebuildMatched(s, live);
  s.resVersion++;
}

export function installAccessTable(
  table: AccessTable,
  root: EntityId,
  owner = `${root}\0${JSON.stringify(table)}`,
): void {
  const s = resolver();
  s.fragments.set(owner, { table, root });
  // Fragments are static build artifacts: record them so application runtimes
  // created LATER (SSR request contexts) replay the same infrastructure.
  staticFragments.set(owner, { table, root });
  rebuildTables();
}

/**
 * Process-wide catalog of every fragment installed by compiled modules in
 * this process. Replayed into each newly created application runtime.
 */
const staticFragments = new Map<
  string,
  { table: AccessTable; root: EntityId }
>();

onRuntimeCreated((runtime) => {
  if (staticFragments.size === 0) return;
  const extensions = runtime.state.extensions;
  let s = extensions.get('access') as AccessResolverState | undefined;
  if (s === undefined) {
    s = createAccessResolverState();
    extensions.set('access', s);
  }
  for (const [owner, fragment] of staticFragments) {
    s.fragments.set(owner, { table: fragment.table, root: fragment.root });
  }
  rebuildTables(s, runtime.state.registry.keys());
});

/** Remove one compiler module's analysis fragment during hot replacement. */
export function uninstallAccessTable(owner: string): void {
  const s = resolver();
  if (!s.fragments.delete(owner)) return;
  staticFragments.delete(owner);
  rebuildTables();
}

/** Clear every installed fragment — test isolation, not app code. */
export function resetAccessTable(): void {
  const s = resolver();
  s.fragments.clear();
  staticFragments.clear();
  rebuildTables();
}

export function isOpaque(variable: string): boolean {
  return resolver().opaqueVars.has(variable);
}

export function getRootId(): EntityId {
  return resolver().rootId;
}

/**
 * Fast path used by compiler-generated commits without an L2 payload.
 * Kept separate so parameter interpolation can tree-shake out of ordinary
 * applications.
 */
export function resolveStaticWrites(
  writes: readonly string[],
): EntityId[] | 'root-subtree' {
  if (writes.some(isOpaque)) return 'root-subtree';
  return resolveStaticKnownWrites(writes);
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
  payload?: Record<string, any>,
): EntityId[] | 'root-subtree' {
  if (writes.some(isOpaque)) return 'root-subtree';

  if (payload) {
    // §5: parametrized patterns collapse wildcard over-approximation into
    // precise ids. Every written variable must fully interpolate — ANY
    // failure (missing params entry, unresolvable path, `prev.*` resolver
    // state, null/undefined value) degrades to the `readers` superset below,
    // never to a partial or empty dirty set (correctness invariant 4).
    const out = new Set<EntityId>();
    let precise = true;
    for (const w of writes) {
      const patterns = resolver().paramReaders.get(w);
      if (patterns === undefined || patterns.length === 0) {
        precise = false;
        break;
      }
      for (const rawPattern of patterns) {
        let failed = false;
        const interpolated = rawPattern.replace(/\{([^}]+)\}/g, (_m, expr: string) => {
          const path = expr.trim();
          // `prev.*` needs resolver state (L2) — unresolvable from a payload
          if (!path.startsWith('payload.')) {
            failed = true;
            return '';
          }
          let cur: unknown = payload;
          for (const seg of path.slice('payload.'.length).split('.')) {
            if (cur === null || typeof cur !== 'object') {
              failed = true;
              return '';
            }
            cur = (cur as Record<string, unknown>)[seg];
          }
          if (cur === undefined || cur === null) {
            failed = true;
            return '';
          }
          // Phase 0: interpolate through the hydration-safe key encoding so
          // precise ids match the row ids rowIdFor actually created.
          // Non-primitive values cannot be encoded (declared SSR limitation)
          // and degrade to the readers superset like any other failure.
          const encoded = encodeListKey(cur);
          if (encoded === null) {
            failed = true;
            return '';
          }
          return encoded;
        });
        if (failed) {
          precise = false;
          break;
        }
        out.add(interpolated);
      }
      if (!precise) break;
      // §5.2: params REPLACE the wildcard superset, but the variable's exact
      // (non-wildcard) readers are still dirtied alongside the precise ids.
      for (const id of resolver().exactReaders.get(w) ?? []) out.add(id);
    }
    if (precise && out.size > 0) return [...out];
  }

  return resolveStaticKnownWrites(writes);
}

function resolveStaticKnownWrites(writes: readonly string[]): EntityId[] {
  const s = resolver();
  // M5.6: full-resolution cache, valid until any expansion changes
  const cacheKey = writes.length === 1 ? (writes[0] as string) : writes.join(' ');
  const hit = s.resolutionCache.get(cacheKey);
  if (hit !== undefined && hit.v === s.resVersion) return hit.result;

  const out = new Set<EntityId>();

  // matchKeys per write key: registry-independent, cached permanently
  const matchKeys = new Set<string>();
  for (const w of writes) {
    let keys = s.matchKeysCache.get(w);
    if (keys === undefined) {
      keys = [];
      for (const k of s.allKeysCache) {
        if (k === w || k.startsWith(`${w}.`) || w.startsWith(`${k}.`)) {
          keys.push(k);
        }
      }
      s.matchKeysCache.set(w, keys);
    }
    for (const k of keys) matchKeys.add(k);
  }

  for (const k of matchKeys) {
    for (const id of s.exactReaders.get(k) ?? []) out.add(id);
    for (const id of s.wildMatched.get(k) ?? []) out.add(id);
  }

  const result = [...out];
  s.resolutionCache.set(cacheKey, { v: s.resVersion, result });
  return result;
}

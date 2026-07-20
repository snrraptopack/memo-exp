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

import { type EntityId } from './kernel';

export interface AccessTable {
  readers: Record<string, string[]>;
  opaque?: string[];
}

let rootId: EntityId = '';
let exactReaders = new Map<string, EntityId[]>();
let wildReaders = new Map<string, RegExp[]>();
let opaqueVars = new Set<string>();

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
      const dedupeKey = `${variable} ${p}`;
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
}

/** Clear every installed fragment — test isolation, not app code. */
export function resetAccessTable(): void {
  rootId = '';
  exactReaders = new Map();
  wildReaders = new Map();
  opaqueVars = new Set();
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
 *
 * Returns 'root-subtree' when any write is opaque — the Imba fallback.
 */
export function resolveWrites(
  writes: readonly string[],
  liveIds: readonly EntityId[],
): EntityId[] | 'root-subtree' {
  if (writes.some(isOpaque)) return 'root-subtree';

  const out = new Set<EntityId>();

  const matchKeys = new Set<string>();
  const allKeys = new Set<string>([...exactReaders.keys(), ...wildReaders.keys()]);

  for (const w of writes) {
    for (const k of allKeys) {
      if (k === w || k.startsWith(`${w}.`) || w.startsWith(`${k}.`)) {
        matchKeys.add(k);
      }
    }
  }

  for (const k of matchKeys) {
      for (const id of exactReaders.get(k) ?? []) out.add(id);
    }

    for (const k of matchKeys) {
      const patterns = wildReaders.get(k);
      if (!patterns) continue;
      for (const regex of patterns) {
        for (const id of liveIds) {
          if (regex.test(id)) out.add(id);
        }
      }
    }

  return [...out];
}

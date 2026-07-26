/**
 * context.ts — shared compiler state and pure AST helpers.
 *
 * Every module (analysis / handlers / lists / emit) takes the same Ctx, so
 * the plugin shell in plugin.ts stays a thin visitor wiring layer. One Ctx
 * is created per compiled module.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { generatedIdentifier, type GeneratedIdentifiers } from './identifiers';

export interface MemoDomOptions {
  /** Module specifier compiled output imports the runtime from. */
  runtimePath?: string;
  /** Entity id of the root component. */
  rootId?: string;
  /**
   * Stable identity for this source module. Defaults to `./component.tsx`.
   * Module-state keys are always `<moduleId>#<binding>[.<path>]`.
   */
  moduleId?: string;
  /**
   * Resolved import metadata supplied by compileModules(). This is public for
   * bundler integrations that perform their own graph/link pass.
   */
  linkedImports?: Record<string, LinkedImport>;
  /** Caller-derived runtime placements for components declared in this file. */
  linkedComponentPaths?: Record<string, string[]>;
  /** Cross-file keyed-row uses for components declared in this file. */
  linkedComponentRows?: Record<string, LinkedComponentRowUse[]>;
}

export interface LinkedStateImport {
  type: 'state';
  kind: StateKind;
  /** Canonical root key of the defining export (`./state.ts#store`). */
  key: string;
}

export interface LinkedFunctionImport {
  type: 'function';
  reads: string[];
  /** Directly proven state writes. */
  writes: string[];
  /** Conservative effects bounded to serialized state roots. */
  boundedWrites: string[];
  /** Effects on arguments, expressed as paths relative to each argument. */
  parameterWrites: ParameterWrite[];
  /** Effects may extend beyond every known root and argument. */
  unbounded: boolean;
}

export interface LinkedComponentImport {
  type: 'component';
  /** Canonical declaration identity (`./Row.tsx#Row`). */
  key: string;
  /** Declared positional prop names, or the single object-prop binding. */
  props: string[];
  objectProps: boolean;
  /** Whether keyed-row compilation can use the allocation-free row ABI. */
  listLightweight: boolean;
}

export interface LinkedComponentRowUse {
  /** Key path relative to the row callback parameter, or null. */
  keyPath: string[] | null;
  /** Canonical module key or binding-relative instance key of the source. */
  sourceKey: string;
  /** The reactive collection source belongs to one caller component instance. */
  sourceLocal: boolean;
}

export type LinkedImport =
  | LinkedStateImport
  | LinkedFunctionImport
  | LinkedComponentImport;

export interface ParameterWrite {
  index: number;
  path: string[];
}

/**
 * Reactive-state classification (the two — three — legal ways JS state changes):
 *   'let'   — rebindable binding; writes are assignments/updates/mutations
 *   'store' — const plain-object literal; writes are property mutations (path-keyed)
 *   'const' - constructor-created object or array; mutations are allowed,
 *             rebinding is a compile error (JS would TypeError at runtime)
 */
export type StateKind = 'let' | 'store' | 'const' | 'computed';

export interface CompInfo {
  /**
   * Names of ALL parent components (a shared child has several). Empty for
   * the root. M5.3: was a single `parent` — multi-parent components misrouted.
   */
  parents: Set<string>;
  /** Number of host JSX elements (diagnostic / future suffix paths). */
  jsxCount: number;
}

/** A list site owned by a component: region id-prefix is '<path(owner)>/<suffix>'. */
export interface SiteRef {
  owner: string;
  suffix: string;
  /** R11: row-analysis data for item-write routing in listed components. */
  itemParam?: string;
  keyExpr?: t.Expression | null;
  sourceKey?: string;
  /** Instance sources invalidate their owner directly, never through a table. */
  sourceLocal?: boolean;
}

/** Module-level helper function summary (M5.3 interprocedural analysis). */
export interface FnSummary {
  reads: Set<string>;
  /** Directly proven state writes. */
  writes: Set<string>;
  /** Conservative effects bounded to module-state roots. */
  boundedWrites: Set<string>;
  /** Effects on arguments, expressed as paths relative to each argument. */
  parameterWrites: ParameterWrite[];
  /** True when effects cannot be bounded to known roots or arguments. */
  unbounded: boolean;
}

export type HelperPath = NodePath<
  t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression
>;

export interface Ctx {
  runtimePath: string;
  rootId: string;
  moduleId: string;

  // ---- module analysis (filled by analysis.ts) ----
  state: Map<string, StateKind>;
  /** Local binding name -> canonical state root. */
  stateKeys: Map<string, string>;
  /** Imported ES bindings cannot be rebound, even when their export is a `let`. */
  importedState: Set<string>;
  /** Linked summaries for imported functions and conservative external calls. */
  importedFunctions: Map<string, FnSummary>;
  importedComponents: Map<string, LinkedComponentImport>;
  /** Graph-linked placements for declarations in this module. */
  linkedComponentPaths: Map<string, string[]>;
  /** Graph-linked keyed-row modes for declarations in this module. */
  linkedComponentRows: Map<string, LinkedComponentRowUse[]>;
  comps: Map<string, CompInfo>;
  compPaths: Map<string, NodePath<t.FunctionDeclaration>>;
  /** Top-level functions WITHOUT JSX — helpers, summarized for interprocedural effects. */
  helpers: Map<string, HelperPath>;
  helperSummaries: Map<string, FnSummary>;
  compReads: Map<string, Set<string>>;
  /** parent comp → child comp → number of static JSX references. */
  childRefCounts: Map<string, Map<string, number>>;
  /**
   * Components used as list rows: child comp name → the sites ('<path(owner)>/<suffix>')
   * at whose 'Row[k]' its instances live. A listed component is multi-instance:
   * never locality-eligible.
   */
  listedSites: Map<string, SiteRef[]>;
  /** Components declared with one object prop (`Row(props: { item: T })`). */
  objectPropComponents: Set<string>;
  /** Declared prop names per component (source order), captured before params are rewritten. */
  compPropNames: Map<string, string[]>;
  /** Memoized isLightweightListedComponent results (the eligibility check traverses the AST). */
  lightweightCache: Map<string, boolean>;
  /** Inline-row reads: '<owner>/<suffix>' → site + state vars read in the row JSX. */
  rowReads: Map<string, { owner: string; suffix: string; vars: Set<string> }>;
  /** Conditional-region reads (R8): '<owner>/when<n>' → site + vars read in condition+branches. */
  condReads: Map<string, { owner: string; suffix: string; vars: Set<string> }>;
  /**
   * R12: instance state — component name → top-level let/var names of its
   * body. Instance state lives in the factory closure of ONE instance: it
   * is readable only by that instance (it reaches children exclusively via
   * props, which R10 re-pushes on every parent render; nested rows are
   * resynced by the M5.5 reconcile machinery). Writes therefore need NO
   * access-table routing — they are unconditionally `markDirty(id)`.
   * Instance names SHADOW same-named module state inside their component.
   */
  instanceState: Map<string, Set<string>>;
  /**
   * R14: per-instance derivations. Unlike module computeds, these need no
   * registry entity or access-table key: the owning instance already renders
   * for every source write/prop push, so its update prologue recomputes them.
   * Map value preserves source order for chained derivations.
   */
  instanceComputeds: Map<string, Map<string, t.Expression>>;
  /**
   * R13: auto-detected computeds — module-level `const x = <state
   * derivation>` (detection by REFERENCE: any expression mentioning state).
   * reads = the source state keys the derivation reads
   * (root names for lets/computeds, dotted keys for stores). The compiler
   * rewrites the declaration to a let + registers a depth-(-1) entity whose
   * render recomputes and commits 'x' downstream ONLY when the value
   * actually changed (computedChanged).
   */
  computeds: Map<string, { reads: Set<string> }>;

  // ---- emission accumulators ----
  header: t.Statement[];
  readers: Map<string, Set<string>>;
  writeConstCounter: number;
  /** Dedupe table for hoisted write-set consts: joined writes → const name. */
  writeConsts: Map<string, string>;
  /** Function nodes whose handler analysis already ran (shared declarations). */
  analyzedFunctions: WeakSet<t.Node>;
  /** Whether a shared handler already emits a commit in its event scope. */
  handlerHasRootCommit: WeakMap<t.Node, boolean>;
  /** Compiler-wide allocator initialized from the original Program scope. */
  identifiers: GeneratedIdentifiers | null;
}

export function createCtx(opts: MemoDomOptions = {}): Ctx {
  const moduleId = opts.moduleId ?? './component.tsx';
  const state = new Map<string, StateKind>();
  const stateKeys = new Map<string, string>();
  const importedState = new Set<string>();
  const importedFunctions = new Map<string, FnSummary>();
  const importedComponents = new Map<string, LinkedComponentImport>();
  for (const [local, linked] of Object.entries(opts.linkedImports ?? {})) {
    if (linked.type === 'state') {
      state.set(local, linked.kind);
      stateKeys.set(local, linked.key);
      importedState.add(local);
    } else if (linked.type === 'function') {
      importedFunctions.set(local, {
        reads: new Set(linked.reads),
        writes: new Set(linked.writes),
        boundedWrites: new Set(linked.boundedWrites),
        parameterWrites: linked.parameterWrites.map((effect) => ({
          index: effect.index,
          path: [...effect.path],
        })),
        unbounded: linked.unbounded,
      });
    } else {
      importedComponents.set(local, {
        ...linked,
        props: [...linked.props],
      });
    }
  }
  const objectPropComponents = new Set<string>();
  const compPropNames = new Map<string, string[]>();
  for (const [local, component] of importedComponents) {
    compPropNames.set(local, [...component.props]);
    if (component.objectProps) objectPropComponents.add(local);
  }
  return {
    runtimePath: opts.runtimePath ?? 'memo-dom',
    rootId: opts.rootId ?? 'App',
    moduleId,
    state,
    stateKeys,
    importedState,
    importedFunctions,
    importedComponents,
    linkedComponentPaths: new Map(
      Object.entries(opts.linkedComponentPaths ?? {}).map(([name, paths]) => [
        name,
        [...paths],
      ]),
    ),
    linkedComponentRows: new Map(
      Object.entries(opts.linkedComponentRows ?? {}).map(([name, uses]) => [
        name,
        uses.map((use) => ({
          keyPath: use.keyPath === null ? null : [...use.keyPath],
          sourceKey: use.sourceKey,
          sourceLocal: use.sourceLocal,
        })),
      ]),
    ),
    comps: new Map(),
    compPaths: new Map(),
    helpers: new Map(),
    helperSummaries: new Map(),
    compReads: new Map(),
    childRefCounts: new Map(),
    listedSites: new Map(),
    objectPropComponents,
    compPropNames,
    lightweightCache: new Map(),
    rowReads: new Map(),
    condReads: new Map(),
    instanceState: new Map(),
    instanceComputeds: new Map(),
    computeds: new Map(),
    header: [],
    readers: new Map(),
    writeConstCounter: 0,
    writeConsts: new Map(),
    analyzedFunctions: new WeakSet(),
    handlerHasRootCommit: new WeakMap(),
    identifiers: null,
  };
}

// ---------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------

/** Register a state binding while preserving a linker-provided import entry. */
export function registerState(ctx: Ctx, name: string, kind: StateKind): void {
  ctx.state.set(name, kind);
  if (!ctx.stateKeys.has(name)) {
    ctx.stateKeys.set(name, `${ctx.moduleId}#${name}`);
  }
}

/**
 * Convert a binding-relative analysis key to its defining module identity.
 * Already-canonical keys (from imported function summaries) pass through.
 */
export function canonicalStateKey(ctx: Ctx, key: string): string {
  if (key.includes('#')) return key;
  const dot = key.indexOf('.');
  const root = dot === -1 ? key : key.slice(0, dot);
  const suffix = dot === -1 ? '' : key.slice(dot);
  return `${ctx.stateKeys.get(root) ?? root}${suffix}`;
}

export function freshWriteConst(ctx: Ctx, writes: readonly string[]): t.Identifier {
  const canonicalWrites = [...new Set(writes.map((w) => canonicalStateKey(ctx, w)))].sort();
  // Dedupe: identical write-sets share one hoisted const (a list row with N
  // handlers writing the same array used to emit N identical WRITES_n).
  const key = canonicalWrites.join(' ');
  const existing = ctx.writeConsts.get(key);
  if (existing !== undefined) return t.identifier(existing);
  const id = generatedIdentifier(ctx, `WRITES_${ctx.writeConstCounter++}`);
  ctx.writeConsts.set(key, id.name);
  ctx.header.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        id,
        t.arrayExpression(canonicalWrites.map((w) => t.stringLiteral(w))),
      ),
    ]),
  );
  return id;
}

/** Static property-path key for `a.b.c` ('a.b.c'), or null if dynamic. */
export function memberKey(node: t.MemberExpression): string | null {
  const parts: string[] = [];
  let cur: t.Expression | t.PrivateName = node;
  while (t.isMemberExpression(cur)) {
    if (cur.computed) {
      if (!t.isStringLiteral(cur.property)) return null;
      parts.unshift(cur.property.value);
    } else {
      if (!t.isIdentifier(cur.property)) return null;
      parts.unshift(cur.property.name);
    }
    if (t.isSuper(cur.object)) return null;
    cur = cur.object;
  }
  while (t.isTSNonNullExpression(cur) || t.isTSAsExpression(cur)) {
    cur = cur.expression;
  }
  if (!t.isIdentifier(cur)) return null;
  parts.unshift(cur.name);
  return parts.join('.');
}

/**
 * R11 — row context for handler analysis. When a handler lives inside a
 * list row, writes to the row's item param affect ONLY that row's DOM
 * (item data flows to the row via reconcile/props; no other entity reads
 * THIS item through the table), so the commit is a plain markDirty on the
 * row entity — no access-table routing at all. The compiler knows the row
 * statically; no runtime payload interpolation is needed.
 *
 * Exception: writing the KEY field changes the row's identity (re-keying
 * is structural), so it falls back to invalidating the collection source.
 */
export interface RowCtx {
  /** The item param name (map callback param / row component's first prop). */
  itemParam: string;
  /** Variable holding the row entity id at the handler site ('rowId'|'id'). */
  rowIdVar: string;
  /** Lightweight rows have no entity; item-local writes call this updater. */
  refreshVar?: string;
  /**
   * Key path relative to itemParam: [] when the key is the item itself
   * (field writes can never change it), null when the key expression is
   * not a plain member chain (unknown → all item writes fall back).
   */
  keyPath: string[] | null;
  /** Reactive source key used when an item write affects collection identity. */
  sourceKey: string;
  /** Instance sources invalidate the row's parent owner directly. */
  sourceLocal?: boolean;
  /** Generated binding holding that parent owner id. */
  ownerIdVar?: string;
}

/**
 * Extract the key path of a row's key={...} expression relative to the
 * item param: key={todo.id} → ['id']; no key attr → [] (identity key);
 * anything non-trivial → null (unknown).
 */
export function keyPathOf(keyExpr: t.Expression | null, itemParam: string): string[] | null {
  if (keyExpr === null) return [];
  const segs: string[] = [];
  let cur: t.Expression = keyExpr;
  while (t.isMemberExpression(cur) && !cur.computed) {
    if (!t.isIdentifier(cur.property)) return null;
    segs.unshift(cur.property.name);
    if (t.isSuper(cur.object)) return null;
    cur = cur.object;
  }
  if (!t.isIdentifier(cur, { name: itemParam }) || segs.length === 0) return null;
  return segs;
}

/** True when writing `writtenSegs` (relative to the item) can change the key. */
export function writeTouchesKey(writtenSegs: string[], keyPath: string[] | null): boolean {
  if (keyPath === null) return true; // unknown key → assume structural
  if (keyPath.length === 0) return false; // identity key → fields never structural
  if (writtenSegs.length > keyPath.length) return false; // writes below the key
  return writtenSegs.every((s, i) => keyPath[i] === s);
}

export interface ComputedAnalysis {
  /**
   * State keys the initializer involves (root names / dotted store keys) —
   * the computed's sources; when impure, also the keys a forbidden write
   * targets, so the compile error actually triggers.
   */
  reads: Set<string>;
  /** True when the expression writes/mutates state or is asynchronous. */
  impure: boolean;
  /** Human-readable reason when impure (first hit wins). */
  reason?: string;
}

/** Root identifier of a member chain (`a.b[c].d` → 'a'), even when dynamic. */
export function memberRootName(node: t.MemberExpression): string | null {
  let cur: t.Expression = node;
  while (true) {
    if (t.isMemberExpression(cur)) {
      if (t.isSuper(cur.object)) return null;
      cur = cur.object;
      continue;
    }
    if (t.isTSNonNullExpression(cur) || t.isTSAsExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    break;
  }
  return t.isIdentifier(cur) ? cur.name : null;
}

/** `const x = { ...plain properties... }` → store object (§4.6). */
export function isStoreObject(init: t.Expression | null | undefined): boolean {
  if (!init || !t.isObjectExpression(init)) return false;
  return init.properties.every(
    (p) =>
      t.isObjectProperty(p) &&
      !p.computed &&
      (t.isIdentifier(p.key) || t.isStringLiteral(p.key)),
  );
}

/**
 * Constructor-created objects and arrays are mutable const roots.
 *
 * This is intentionally constructor-agnostic: receiver invalidation does not
 * depend on a built-in collection or method-semantics table.
 */
export function isConstObjectState(
  init: t.Expression | null | undefined,
): boolean {
  if (!init) return false;
  return t.isArrayExpression(init) || t.isNewExpression(init);
}

/** Unwrap a JSX attribute value: strings pass through, `{expr}` unwraps. */
export function attrExpr(value: t.JSXAttribute['value']): t.Expression | null {
  if (value == null) return null;
  if (t.isStringLiteral(value)) return value;
  if (t.isJSXExpressionContainer(value)) {
    return t.isJSXEmptyExpression(value.expression)
      ? null
      : (value.expression as t.Expression);
  }
  return null; // JSX element as attribute value — unsupported
}

/**
 * Does an expression reference module state anywhere inside? Manual walk
 * (no NodePath available in every caller); descends into nested functions —
 * conservative on purpose.
 */
export function exprReadsState(ctx: Ctx, expr: t.Node, compName?: string): boolean {
  const inst = compName !== undefined ? ctx.instanceState.get(compName) : undefined;
  const derived =
    compName !== undefined ? ctx.instanceComputeds.get(compName) : undefined;
  let reads = false;
  const probe = (n: t.Node): void => {
    if (reads) return;
    if (
      t.isIdentifier(n) &&
      (ctx.state.has(n.name) ||
        inst?.has(n.name) === true ||
        derived?.has(n.name) === true)
    ) {
      reads = true;
      return;
    }
    for (const key of t.VISITOR_KEYS[n.type] ?? []) {
      const c = (n as any)[key];
      if (Array.isArray(c)) {
        for (const x of c) {
          if (x && typeof x === 'object' && 'type' in x) probe(x as t.Node);
        }
      } else if (c && typeof c === 'object' && 'type' in c) {
        probe(c as t.Node);
      }
    }
  };
  probe(expr);
  return reads;
}

/** Walk every node under `root` (raw AST walk — no NodePath needed). */
export function walkNodes(root: t.Node, visit: (n: t.Node) => void): void {
  const walk = (n: t.Node): void => {
    visit(n);
    for (const key of t.VISITOR_KEYS[n.type] ?? []) {
      const c = (n as any)[key];
      if (Array.isArray(c)) {
        for (const x of c) {
          if (x && typeof x === 'object' && 'type' in x) walk(x as t.Node);
        }
      } else if (c && typeof c === 'object' && 'type' in c) {
        walk(c as t.Node);
      }
    }
  };
  walk(root);
}

/** Does this raw AST subtree contain JSX? (node-level twin of lists.containsJsx) */
export function nodeHasJsx(root: t.Node): boolean {
  let found = false;
  walkNodes(root, (n) => {
    if (t.isJSXElement(n) || t.isJSXFragment(n)) found = true;
  });
  return found;
}

/**
 * All state identifiers referenced in a raw AST subtree, root-keyed
 * ('store.x.y' contributes 'store' — the resolver's prefix matching covers
 * dotted write/read paths). Used for R8 region attribution.
 */
export function collectStateIds(ctx: Ctx, root: t.Node): Set<string> {
  const out = new Set<string>();
  walkNodes(root, (n) => {
    if (t.isIdentifier(n) && ctx.state.has(n.name)) out.add(n.name);
  });
  return out;
}

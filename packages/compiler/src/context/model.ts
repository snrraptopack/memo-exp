/**
 * context.ts — shared compiler state and pure AST helpers.
 *
 * Every module (analysis / handlers / lists / emit) takes the same Ctx, so
 * the plugin shell in plugin.ts stays a thin visitor wiring layer. One Ctx
 * is created per compiled module.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type {
  ComponentPropsPlan,
  ControlFlowDerivation,
  LocalDerivation,
} from '../components/props';
import type { GeneratedIdentifiers } from '../identifiers';

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
  /** Caller-resolved state boundaries for each declaration's named props. */
  linkedComponentPropSources?: Record<
    string,
    Record<string, LinkedComponentPropSource>
  >;
}

export interface LinkedStateImport {
  type: 'state';
  kind: StateKind;
  /** Canonical root key of the defining export (`./state.ts#store`). */
  key: string;
  /** Finite intrinsic-tag identities declared by a string-literal union. */
  tagCandidates?: string[];
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
  /** Declared positional names or closed object-pattern property names. */
  props: string[];
  objectProps: boolean;
  /** Generic object bindings and object rest accept additional properties. */
  acceptsUnknownProps: boolean;
  hasWholeDefault: boolean;
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

export interface LinkedComponentPropSource {
  /** Canonical state boundaries that may supply this prop. */
  keys: string[];
  /** At least one call site cannot be bounded to canonical module state. */
  rootFallback: boolean;
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

/** One compiler-owned reactive side effect declared in a component body. */
export interface EffectSite {
  /** Stable source-order suffix within the owning component. */
  index: number;
  /** Source statement removed from ordinary factory initialization. */
  statement: t.ExpressionStatement;
  /** Callback registered with the runtime after DOM creation. */
  callback: t.ArrowFunctionExpression | t.FunctionExpression;
  /** Canonical or binding-relative module state read by the callback. */
  moduleReads: Set<string>;
  /** Instance state/prop roots that can change callback observations. */
  localReads: Set<string>;
  /** Instance local derivations read by the callback. */
  localDerivationReads: Set<string>;
}

/** One singleton reactive effect declared directly at module scope. */
export interface ModuleEffectSite {
  index: number;
  statement: t.ExpressionStatement;
  callback: t.ArrowFunctionExpression | t.FunctionExpression;
  moduleReads: Set<string>;
  entityId: string;
}

export interface ModuleControlFlowDerivation {
  statement: t.IfStatement | t.SwitchStatement;
  bindings: string[];
  sources: string[];
  entityId: string;
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
  /** Finite intrinsic-tag identities proven by state type annotations. */
  stateTagCandidates: Map<string, string[]>;
  /** Imported ES bindings cannot be rebound, even when their export is a `let`. */
  importedState: Set<string>;
  /** Linked summaries for imported functions and conservative external calls. */
  importedFunctions: Map<string, FnSummary>;
  importedComponents: Map<string, LinkedComponentImport>;
  /** Graph-linked placements for declarations in this module. */
  linkedComponentPaths: Map<string, string[]>;
  /** Graph-linked keyed-row modes for declarations in this module. */
  linkedComponentRows: Map<string, LinkedComponentRowUse[]>;
  linkedComponentPropSources: Map<
    string,
    Map<string, LinkedComponentPropSource>
  >;
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
  /** Components mounted lexically inside conditional branch factories. */
  conditionalComponentSites: Map<string, SiteRef[]>;
  /** Local and imported JSX call contracts, captured before params are rewritten. */
  componentProps: Map<string, ComponentPropsPlan>;
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
  /** Ordered local binding/pattern derivations replayed in the owner update. */
  instanceDerivations: Map<string, LocalDerivation[]>;
  /** Pure top-level if/switch calculations replayed in source order. */
  instanceControlFlow: Map<string, ControlFlowDerivation[]>;
  /** All bindings introduced by local derivations, for locality and writes. */
  instanceDerivedBindings: Map<string, Set<string>>;
  /** Numeric dirty reasons for exact local write roots. */
  instanceReasonIds: Map<string, Map<string, number>>;
  /** Components whose local dependency graph has skippable work. */
  selectiveDerivationComponents: Set<string>;
  /** Compiler-owned reactive effects, in source order per component. */
  effects: Map<string, EffectSite[]>;
  /** Module-owned singleton effects, in source order. */
  moduleEffects: ModuleEffectSite[];
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
  /** Pure exhaustive module-level if/switch calculations. */
  moduleControlFlow: ModuleControlFlowDerivation[];

  // ---- emission accumulators ----
  header: t.Statement[];
  readers: Map<string, Set<string>>;
  writeConstCounter: number;
  /** Dedupe table for hoisted write-set consts: joined writes → const name. */
  writeConsts: Map<string, string>;
  reasonConstCounter: number;
  /** Dedupe table for hoisted multi-reason arrays. */
  reasonConsts: Map<string, string>;
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
  const stateTagCandidates = new Map<string, string[]>();
  const importedState = new Set<string>();
  const importedFunctions = new Map<string, FnSummary>();
  const importedComponents = new Map<string, LinkedComponentImport>();
  for (const [local, linked] of Object.entries(opts.linkedImports ?? {})) {
    if (linked.type === 'state') {
      state.set(local, linked.kind);
      stateKeys.set(local, linked.key);
      if (linked.tagCandidates !== undefined) {
        stateTagCandidates.set(local, [...linked.tagCandidates]);
      }
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
  const componentProps = new Map<string, ComponentPropsPlan>();
  for (const [local, component] of importedComponents) {
    componentProps.set(local, {
      mode: component.objectProps ? 'object' : 'positional',
      names: [...component.props],
      acceptsUnknown: component.acceptsUnknownProps,
      bindings: [],
      params: [],
      hasWholeDefault: component.hasWholeDefault,
    });
  }
  return {
    runtimePath: opts.runtimePath ?? '@memoized-dom/runtime',
    rootId: opts.rootId ?? 'App',
    moduleId,
    state,
    stateKeys,
    stateTagCandidates,
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
    linkedComponentPropSources: new Map(
      Object.entries(opts.linkedComponentPropSources ?? {}).map(
        ([component, sources]) => [
          component,
          new Map(
            Object.entries(sources).map(([name, source]) => [
              name,
              {
                keys: [...source.keys],
                rootFallback: source.rootFallback,
              },
            ]),
          ),
        ],
      ),
    ),
    comps: new Map(),
    compPaths: new Map(),
    helpers: new Map(),
    helperSummaries: new Map(),
    compReads: new Map(),
    childRefCounts: new Map(),
    listedSites: new Map(),
    conditionalComponentSites: new Map(),
    componentProps,
    lightweightCache: new Map(),
    rowReads: new Map(),
    condReads: new Map(),
    instanceState: new Map(),
    instanceDerivations: new Map(),
    instanceControlFlow: new Map(),
    instanceDerivedBindings: new Map(),
    instanceReasonIds: new Map(),
    selectiveDerivationComponents: new Set(),
    effects: new Map(),
    moduleEffects: [],
    computeds: new Map(),
    moduleControlFlow: [],
    header: [],
    readers: new Map(),
    writeConstCounter: 0,
    writeConsts: new Map(),
    reasonConstCounter: 0,
    reasonConsts: new Map(),
    analyzedFunctions: new WeakSet(),
    handlerHasRootCommit: new WeakMap(),
    identifiers: null,
  };
}

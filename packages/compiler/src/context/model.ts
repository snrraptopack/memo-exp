/**
 * context.ts — shared compiler state and pure AST helpers.
 *
 * Every module (analysis / handlers / lists / emit) takes the same Ctx, so
 * the plugin shell in plugin.ts stays a thin visitor wiring layer. One Ctx
 * is created per compiled module.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ScopeAnalysis } from '../ast';
import type {
  ComponentPropsPlan,
  ControlFlowDerivation,
  LocalDerivation,
} from '../components/props';
import type { GeneratedIdentifiers } from '../identifiers';
import type {
  CompilerRouteDefinition,
  CompilerRouteElement,
} from '../router';

export const DEFAULT_TRANSPARENT_ASYNC_SOURCES: readonly TransparentAsyncSourceDefinition[] = [
  {
    module: '@memoized-dom/data',
    source: '$fetch',
    track: '$track',
    group: 'Group',
    pending: 'Pending',
    error: 'Error',
  },
];

export interface MemoDomOptions {
  /** Module specifier compiled output imports the runtime from. */
  runtimePath?: string;
  /** Module specifier used by compiler-generated router integration. */
  routerPath?: string;
  /** Runtime helpers used by compiler-transparent async data sources. */
  dataRuntimePath?: string;
  /**
   * Library declarations that participate in transparent async lowering.
   * The default describes @memoized-dom/data without baking its local import
   * aliases into the analysis.
   */
  transparentAsyncSources?: readonly TransparentAsyncSourceDefinition[];
  /** Emit dev-only live-component ownership used by framework HMR adapters. */
  hot?: boolean;
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
  /** Linker-resolved render-slot props for declarations in this module. */
  linkedComponentRenderProps?: Record<string, string[]>;
  /**
   * SSR Phase 1.3 lowering: rewrite reactive module-state bindings into
   * request-owned state-cell operations (server builds only).
   */
  moduleStateCells?: boolean;
}

export interface TransparentAsyncSourceDefinition {
  /** Public module from which the authored intrinsics are imported. */
  module: string;
  /** Export that creates a transparent source value. */
  source: string;
  /** Export that exposes reactive request state without resolving the value. */
  track?: string;
  /** Export that exposes imperative operations without resolving the value. */
  operations?: string;
  /** Compile-time local presentation boundary and its policy declarations. */
  group?: string;
  pending?: string;
  error?: string;
}

export interface TransparentPresentationPolicy {
  pending: string;
  error: string;
}

/** Compiler/linker-only root facts derived from an authored mount() call. */
export interface InternalMemoDomOptions extends MemoDomOptions {
  rootId?: string;
  rootComponent?: string;
  /** Application-wide route graph supplied by compileModules(). */
  linkedRoutes?: readonly CompilerRouteDefinition[];
  /** Emit and install the application manifest from this module. */
  emitRouteManifest?: boolean;
}

export interface LinkedStateImport {
  type: 'state';
  kind: StateKind;
  /** Canonical root key of the defining export (`./state.ts#store`). */
  key: string;
  /** RFC §16.4: import carries a module transparent-source ref. */
  transparentSource?: boolean;
  /** Finite intrinsic-tag identities declared by a string-literal union. */
  tagCandidates?: string[];
  /** Finite component identities reachable through this state/registry. */
  componentCandidates?: LinkedDynamicComponentCandidate[];
}

export interface LinkedFunctionImport {
  type: 'function';
  /** Finite intrinsic-tag identities declared by the helper return type. */
  tagCandidates?: string[];
  /** Finite component identities declared by helper returns. */
  componentCandidates?: LinkedDynamicComponentCandidate[];
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
  /** Host JSX event names prebound once by a keyed-list caller. */
  delegatedEvents?: string[];
  /** Props consumed as compiler-owned mount slots. */
  renderProps?: string[];
  /** Props consumed as caller-owned structural row factories. */
  renderCallbacks?: string[];
  /** Props consumed as DOM ref adapters. */
  refProps?: string[];
  /** Canonical module dependencies read by this component and descendants. */
  subtreeReads?: string[];
}

export interface LinkedDynamicComponentCandidate
  extends Omit<LinkedComponentImport, 'type'> {
  /** Module specifier synthesized into the consuming module. */
  source: string;
  /** Named export imported from `source`. */
  imported: string;
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
  /** The prop carries a compiler-transparent async source holder. */
  transparent?: boolean;
}

export interface LinkedValueImport {
  type: 'value';
}

export type LinkedImport =
  | LinkedStateImport
  | LinkedFunctionImport
  | LinkedComponentImport
  | LinkedValueImport;
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

/**
 * A `.map(...)` call, including optional-chained forms such as
 * `items?.map(...)` or `resource.data?.map(...)`.
 */
export type MapCallExpression = t.CallExpression | t.OptionalCallExpression;

/** One owner-local list dependency addressable directly by its row key. */
export interface TargetedListDependency {
  /** Instance-owned collection root whose writes require reconciliation. */
  source: string;
  /** Instance-state value compared directly with the authored row key. */
  value: string;
}

/** Conservative direct-item mutation plan for one instance-owned keyed list. */
export interface KeyedListMutationPlan {
  source: string;
  keyPath: string[];
  keysVariable: string;
  targetedReason: string;
  topologyReason: string;
  structuralReason: string;
  call: MapCallExpression;
}

/** One compiler-owned reactive side effect declared in a component body. */
export interface EffectSite {
  /** Stable source-order suffix within the owning component. */
  index: number;
  /** Source statement removed from ordinary factory initialization. */
  statement: t.Statement;
  /** Callback registered with the runtime after DOM creation. */
  callback: t.Expression;
  /** Canonical or binding-relative module state read by the callback. */
  moduleReads: Set<string>;
  /** Instance state/prop roots that can change callback observations. */
  localReads: Set<string>;
  /** Instance local derivations read by the callback. */
  localDerivationReads: Set<string>;
  /** Reactive activation gate for a conditional effect. */
  condition: t.Expression | null;
  conditionModuleReads: Set<string>;
  conditionLocalReads: Set<string>;
  conditionLocalDerivationReads: Set<string>;
}

/** One singleton reactive effect declared directly at module scope. */
export interface ModuleEffectSite {
  index: number;
  statement: t.Statement;
  callback: t.Expression;
  moduleReads: Set<string>;
  condition: t.Expression | null;
  conditionModuleReads: Set<string>;
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
  routerPath: string;
  dataRuntimePath: string;
  transparentAsyncSources: readonly TransparentAsyncSourceDefinition[];
  rootId: string;
  rootComponent: string | null;
  hot: boolean;
  /** SSR Phase 1.3 lowering: lower reactive module state into request cells. */
  moduleStateCells: boolean;
  moduleId: string;
  linkedRoutes: readonly CompilerRouteDefinition[] | null;
  emitRouteManifest: boolean;
  routeElements: WeakMap<t.JSXElement, CompilerRouteElement>;
  localRoutes: CompilerRouteDefinition[];
  usesRouter: boolean;
  usesTransparentData: boolean;
  /** Local import bindings classified by provider metadata. */
  transparentSourceFactories: Set<string>;
  transparentTrackFactories: Set<string>;
  transparentSourcePassthroughs: Set<string>;
  transparentGroups: Set<string>;
  transparentPendingPolicies: Set<string>;
  transparentErrorPolicies: Set<string>;
  /** Component-local source holders and track-state aliases. */
  transparentSources: Map<string, Set<string>>;
  transparentTrackBindings: Map<string, Map<string, readonly string[]>>;
  /** Module-scope transparent sources: local binding name → canonical key. */
  transparentModuleSources: Map<string, string>;
  /** Direct prop binding -> authored prop name for transported source holders. */
  transparentSourceProps: Map<string, Map<string, string>>;
  /** Private factory parameter carrying inherited presentation renderers. */
  transparentPolicyParams: Map<string, t.Identifier>;
  /** Nearest lexical Group policies attached to component prop call sites. */
  transparentGroupCallPolicies: WeakMap<
    t.JSXElement,
    Map<string, TransparentPresentationPolicy>
  >;

  // ---- module analysis (filled by analysis.ts) ----
  /** Parser-neutral lexical scope and parent index for the current AST shape. */
  astAnalysis: ScopeAnalysis | null;
  state: Map<string, StateKind>;
  /** Local binding name -> canonical state root. */
  stateKeys: Map<string, string>;
  /** Finite intrinsic-tag identities proven by state type annotations. */
  stateTagCandidates: Map<string, string[]>;
  functionTagCandidates: Map<string, string[]>;
  stateComponentCandidates: Map<string, string[]>;
  functionComponentCandidates: Map<string, string[]>;
  linkedDynamicComponentCandidates: Map<
    string,
    LinkedDynamicComponentCandidate[]
  >;
  /** Imported ES bindings cannot be rebound, even when their export is a `let`. */
  importedState: Set<string>;
  /** Linked summaries for imported functions and conservative external calls. */
  importedFunctions: Map<string, FnSummary>;
  importedComponents: Map<string, LinkedComponentImport>;
  importedValues: Set<string>;
  linkedComponentPaths: Map<string, string[]>;
  /** Graph-linked keyed-row modes for declarations in this module. */
  linkedComponentRows: Map<string, LinkedComponentRowUse[]>;
  linkedComponentPropSources: Map<
    string,
    Map<string, LinkedComponentPropSource>
  >;
  linkedComponentRenderProps: Map<string, string[]>;
  comps: Map<string, CompInfo>;
  compPaths: Map<string, NodePath<t.FunctionDeclaration>>;
  /** Top-level functions WITHOUT JSX — helpers, summarized for interprocedural effects. */
  helpers: Map<string, HelperPath>;
  /** JSX-returning functions expanded at local render call sites. */
  jsxHelpers: Map<string, HelperPath>;
  helperSummaries: Map<string, FnSummary>;
  compReads: Map<string, Set<string>>;
  /** parent comp → child comp → number of static JSX references. */
  childRefCounts: Map<string, Map<string, number>>;
  /**
   * Lexical component owners that author one or more deferred render slots.
   * Runtime mounts after the first receive a `$slot[n]` identity segment;
   * access-table paths expand only for these owners.
   */
  renderSlotOwners: Set<string>;
  /**
   * Components used as list rows: child comp name → the sites ('<path(owner)>/<suffix>')
   * at whose 'Row[k]' its instances live. A listed component is multi-instance:
   * never locality-eligible.
   */
  listedSites: Map<string, SiteRef[]>;
  /** Local declarations containing one or more host JSX event attributes. */
  componentsWithHostEvents: Set<string>;
  /** Immutable event names captured before component AST emission mutates JSX. */
  componentHostEvents: Map<string, string[]>;
  /** Components mounted lexically inside conditional branch factories. */
  conditionalComponentSites: Map<string, SiteRef[]>;
  /** Components mounted beneath keyed inline host-row factories. */
  rowComponentSites: Map<string, SiteRef[]>;
  /** Local and imported JSX call contracts, captured before params are rewritten. */
  componentProps: Map<string, ComponentPropsPlan>;
  /** Memoized isLightweightListedComponent results (the eligibility check traverses the AST). */
  lightweightCache: Map<string, boolean>;
  /** Inline-row reads: '<owner>/<suffix>' → site + state vars read in the row JSX. */
  rowReads: Map<string, { owner: string; suffix: string; vars: Set<string> }>;
  /** Conditional-region reads (R8): '<owner>/when<n>' → site + vars read in condition+branches. */
  condReads: Map<string, { owner: string; suffix: string; vars: Set<string> }>;
  /** Map call → owner-local values whose changes affect only old/new keyed rows. */
  targetedListDependencies: WeakMap<MapCallExpression, TargetedListDependency[]>;
  /** Components that need dirty reasons for targeted list refreshes. */
  targetedListComponents: Set<string>;
  /** Map call -> direct keyed-item mutation journal used by that one list. */
  keyedListMutations: WeakMap<MapCallExpression, KeyedListMutationPlan>;
  /** Component -> source root -> journal plan, for handler write analysis. */
  keyedListMutationSources: Map<string, Map<string, KeyedListMutationPlan>>;
  /** Sources used by multiple list sites deliberately keep full reconciliation. */
  disabledKeyedListMutationSources: Set<string>;
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
  /** Components whose rendered output reads state controlled by opaque code. */
  volatileComponents: Set<string>;
  /** Component-local/module bindings whose current value is owned by opaque code. */
  opaqueBindings: Map<string, Set<string>>;
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
  /**
   * Effects a component-local helper performs on its own parameters, keyed by
   * the helper's function node. Callers fold these through their arguments so
   * row-relative writes route from the call site (whose scope owns the row
   * identifiers) instead of the helper body (which does not).
   */
  localParamEffects: WeakMap<t.Node, ParameterWrite[]>;
  /** Compiler-wide allocator initialized from the original Program scope. */
  identifiers: GeneratedIdentifiers | null;
}

export function createCtx(opts: InternalMemoDomOptions = {}): Ctx {
  const moduleId = opts.moduleId ?? './component.tsx';
  const state = new Map<string, StateKind>();
  const stateKeys = new Map<string, string>();
  const stateTagCandidates = new Map<string, string[]>();
  const functionTagCandidates = new Map<string, string[]>();
  const stateComponentCandidates = new Map<string, string[]>();
  const functionComponentCandidates = new Map<string, string[]>();
  const linkedDynamicComponentCandidates = new Map<
    string,
    LinkedDynamicComponentCandidate[]
  >();
  const transparentModuleSources = new Map<string, string>();
  const importedState = new Set<string>();
  const importedFunctions = new Map<string, FnSummary>();
  const importedComponents = new Map<string, LinkedComponentImport>();
  const importedValues = new Set<string>();
  for (const [local, linked] of Object.entries(opts.linkedImports ?? {})) {
    if (linked.type === 'state') {
      state.set(local, linked.kind);
      stateKeys.set(local, linked.key);
      if (linked.tagCandidates !== undefined) {
        stateTagCandidates.set(local, [...linked.tagCandidates]);
      }
      if (linked.componentCandidates !== undefined) {
        linkedDynamicComponentCandidates.set(
          local,
          linked.componentCandidates.map((candidate) => ({ ...candidate })),
        );
      }
      if (linked.transparentSource === true) {
        transparentModuleSources.set(local, linked.key);
      }
      importedState.add(local);
    } else if (linked.type === 'function') {
      if (linked.tagCandidates !== undefined) {
        functionTagCandidates.set(local, [...linked.tagCandidates]);
      }
      if (linked.componentCandidates !== undefined) {
        linkedDynamicComponentCandidates.set(
          local,
          linked.componentCandidates.map((candidate) => ({ ...candidate })),
        );
      }
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
    } else if (linked.type === 'value') {
      importedValues.add(local);
    } else {
      importedComponents.set(local, linked);
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
      renderProps: [...(component.renderProps ?? [])],
      renderCallbacks: [...(component.renderCallbacks ?? [])],
      refProps: [...(component.refProps ?? [])],
    });
  }
  const linkedComponentRenderProps = new Map(
    Object.entries(opts.linkedComponentRenderProps ?? {}).map(
      ([component, props]) => [component, [...props]],
    ),
  );
  return {
    runtimePath: opts.runtimePath ?? '@memoized-dom/runtime',
    routerPath: opts.routerPath ?? '@memoized-dom/router/internal',
    dataRuntimePath: opts.dataRuntimePath ?? '@memoized-dom/data/internal',
    transparentAsyncSources: opts.transparentAsyncSources ??
      DEFAULT_TRANSPARENT_ASYNC_SOURCES,
    rootId: opts.rootId ?? 'App',
    rootComponent: opts.rootComponent ?? null,
    hot: opts.hot ?? false,
    moduleStateCells: opts.moduleStateCells ?? false,
    moduleId,
    linkedRoutes: opts.linkedRoutes ?? null,
    emitRouteManifest:
      opts.emitRouteManifest ?? opts.linkedRoutes === undefined,
    routeElements: new WeakMap(),
    localRoutes: [],
    astAnalysis: null,
    usesRouter: false,
    usesTransparentData: false,
    transparentSourceFactories: new Set(),
    transparentTrackFactories: new Set(),
    transparentSourcePassthroughs: new Set(),
    transparentGroups: new Set(),
    transparentPendingPolicies: new Set(),
    transparentErrorPolicies: new Set(),
    transparentSources: new Map(),
    transparentTrackBindings: new Map(),
    importedState,
    importedFunctions,
    importedComponents,
    importedValues,
    transparentModuleSources,
    transparentSourceProps: new Map(),
    transparentPolicyParams: new Map(),
    transparentGroupCallPolicies: new WeakMap(),
    state,
    stateKeys,
    stateTagCandidates,
    functionTagCandidates,
    stateComponentCandidates,
    functionComponentCandidates,
    linkedDynamicComponentCandidates,
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
                transparent: source.transparent === true,
              },
            ]),
          ),
        ],
      ),
    ),
    comps: new Map(),
    compPaths: new Map(),
    helpers: new Map(),
    jsxHelpers: new Map(),
    helperSummaries: new Map(),
    compReads: new Map(),
    childRefCounts: new Map(),
    renderSlotOwners: new Set(),
    listedSites: new Map(),
    componentsWithHostEvents: new Set(),
    componentHostEvents: new Map(),
    conditionalComponentSites: new Map(),
    rowComponentSites: new Map(),
    componentProps,
    linkedComponentRenderProps,
    lightweightCache: new Map(),
    rowReads: new Map(),
    condReads: new Map(),
    targetedListDependencies: new WeakMap(),
    targetedListComponents: new Set(),
    keyedListMutations: new WeakMap(),
    keyedListMutationSources: new Map(),
    disabledKeyedListMutationSources: new Set(),
    instanceState: new Map(),
    instanceDerivations: new Map(),
    instanceControlFlow: new Map(),
    instanceDerivedBindings: new Map(),
    instanceReasonIds: new Map(),
    selectiveDerivationComponents: new Set(),
    volatileComponents: new Set(),
    opaqueBindings: new Map(),
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
    localParamEffects: new WeakMap(),
    identifiers: null,
  };
}

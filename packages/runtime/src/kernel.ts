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
 * concerns layered on top. Keep this file focused on entity lifetime.
 *
 * SSR Slice 1.1 — application runtimes:
 * Every piece of mutable kernel state lives inside an ApplicationRuntime.
 * The browser operates on one ambient default runtime, so existing imports
 * behave exactly as before. Server entry points create a fresh runtime per
 * request with createApplicationRuntime(), render inside it via
 * setActiveApplicationRuntime()/runWithApplicationRuntime(), and release it
 * with dispose(). Two active renders can never observe each other's entity,
 * scheduler, invalidation, or diagnostic state.
 *
 * INVARIANT (the M5 compiler guarantees this): parents register BEFORE their
 * children, so child links exist. Violations don't corrupt rendering — they
 * only orphan children from subtree teardown.
 */
import { runWithApplicationRuntime } from './application-scope';
export { runWithApplicationRuntime } from './application-scope';
export { register } from './volatile';
export { markDirty, markDirtyMany, markDirtySubtree } from './reasoned-invalidation';
import {
  clearDirtyReasons,
  createDirtyReasonStore,
  takeDirtyReasons,
  type DirtyReasonInput,
  type DirtyReasons,
  type DirtyReasonStore,
} from './dirty-reasons';
import { resolveEnvironment, type RenderEnvironment } from './environment';
export type EntityId = string;
export type { DirtyReasonInput, DirtyReasons } from './dirty-reasons';

/**
 * A mounted component instance.
 * `render` is the UPDATE branch only — the creation branch ran once at mount
 * and cached its nodes in a closure.
 * `depth` and `children` are managed by register(); callers only provide
 * id, parent, render.
 */
export interface Entity {
  id: EntityId;
  parent: EntityId | null;
  render: (reasons?: DirtyReasons) => void;
  /** Opaque pull state is conservatively reevaluated once per browser frame. */
  volatile?: boolean;
  /** Effects drain only after all ordinary render work is complete. */
  phase?: 'render' | 'effect';
  depth?: number;
  children?: Set<EntityId>;
  /** @internal Detached activation owner, propagated through child creation. */
  preparation?: RenderPreparationOwner;
}

/** @internal Lifecycle interception used by detached subtree preparation. */
export interface RenderPreparationOwner {
  attach(entity: Entity): void;
  deferRef(activate: () => void): () => void;
  /** @internal Only explicit render-read scopes participate in readiness. */
  consume(dependency: PreparationDependency): void;
  collect<T>(owner: string, render: () => T, site?: string): T;
  releaseRead(owner: string, site: string): void;
}

/** @internal Resource adapter; the kernel never imports a data implementation. */
export interface PreparationDependency {
  readonly key: object;
  snapshot(): { status: 'pending' | 'ready' | 'error'; error?: unknown };
  subscribe(invalidate: () => void): () => void;
  /** @internal Retry a borrowed failed operation after staged owners retire. */
  retry?(): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Scheduler — injectable, because the commit timing policy is not universal:
//   browser  → queueMicrotask (batch one turn, settle DOM before paint)
//   tests    → synchronous or manual pump
//   SSR      → never schedules at all
// ---------------------------------------------------------------------------
export type Scheduler = (fn: () => void) => void;

// WebIDL functions are this-sensitive: a detached `queueMicrotask` throws
// "Illegal invocation" in browsers, so the default scheduler must be bound.
const defaultScheduler: Scheduler =
  typeof queueMicrotask === 'function'
    ? queueMicrotask.bind(globalThis)
    : (fn) => Promise.resolve().then(fn);

/** Upper bound on commits' drain passes before a cycle is declared. */
const MAX_COMMIT_PASSES = 100;

/**
 * Cycle diagnostics bound: an entity rendering more often than this within
 * ONE commit indicates an update dirtying its own readers.
 */
const MAX_ENTITY_RENDERS_PER_COMMIT = 12;

/**
 * All mutable kernel bookkeeping for one application/request. Nothing else
 * in the kernel may hold render-affecting state at module scope.
 */
interface KernelState {
  readonly registry: Map<EntityId, Entity>;
  readonly dirty: Set<EntityId>;
  /** Exact numeric causes per dirty entity until their next render. */
  readonly dirtyReasons: DirtyReasonStore;
  /** Cached id array for the access resolver — null when stale. */
  idsCache: EntityId[] | null;
  /** Monotonic registry generation for resolver caches. */
  generation: number;
  scheduler: Scheduler;
  scheduled: boolean;
  inCommit: boolean;
  /** Cycle diagnostics — non-null only while a commit drain runs. */
  renderingEntity: EntityId | null;
  renderCounts: Map<EntityId, number> | null;
  markedBy: Map<EntityId, EntityId> | null;
  /**
   * Named per-runtime stores for kernel-adjacent subsystems (cleanup, prop
   * boxes, access resolver, mount bookkeeping). Modules own their store
   * shapes; the kernel only provides request-scoped storage and lifetime.
   */
  readonly extensions: Map<string, unknown>;
  /** Capability descriptor selecting browser/server behavior. */
  environment: RenderEnvironment;
  /** @internal Preparation context for synchronous creation/update work. */
  preparation?: RenderPreparationOwner;
}

function createKernelState(
  environment?: Partial<RenderEnvironment>,
): KernelState {
  return {
    registry: new Map(),
    dirty: new Set(),
    dirtyReasons: createDirtyReasonStore(),
    idsCache: null,
    generation: 0,
    scheduler: defaultScheduler,
    scheduled: false,
    inCommit: false,
    renderingEntity: null,
    renderCounts: null,
    markedBy: null,
    extensions: new Map(),
    environment: resolveEnvironment(environment),
  };
}

/**
 * One isolated application/request runtime. Browser code uses the ambient
 * default; server entry points create, activate, and dispose one per request.
 */
export interface ApplicationRuntime {
  readonly id: string;
  /**
   * Unregister every entity (draining cleanup hooks) and drop all pending
   * bookkeeping. The handle must not be activated afterwards.
   */
  dispose(): void;
  /** @internal Test/introspection surface. Not part of the paradigm API. */
  readonly state: KernelState;
}

let runtimeSequence = 0;

/** Create an isolated runtime. Server entry points call this per request. */
export function createApplicationRuntime(
  id = `runtime-${++runtimeSequence}`,
  environment?: Partial<RenderEnvironment>,
): ApplicationRuntime {
  const state = createKernelState(environment);
  const runtime: ApplicationRuntime = {
    id,
    state,
    dispose() {
      const errors: unknown[] = [];
      // Disposal hooks resolve their stores through the active runtime. A
      // detached generation may be abandoned outside its original render
      // call, so teardown must explicitly reactivate the owning runtime.
      runWithApplicationRuntime(runtime, () => {
        const ids = [...state.registry.keys()];
        for (const id of ids) {
          try { unregisterSubtreeInState(state, id); }
          catch (error) { errors.push(error); }
        }
        for (const listener of runtimeDisposedListeners) {
          try { listener(runtime); }
          catch (error) { errors.push(error); }
        }
        state.dirty.clear();
        state.dirtyReasons.clear();
        state.idsCache = null;
        state.scheduled = false;
        state.inCommit = false;
        state.renderingEntity = null;
        state.renderCounts = null;
        state.markedBy = null;
        state.preparation = undefined;
        state.extensions.clear();
      });
      if (activeRuntime === runtime) {
        // Re-activating the default keeps ambient semantics predictable
        // after a server request disposes its runtime mid-flight.
        activeRuntime = defaultRuntime;
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, '[memo-dom] runtime disposal failed');
    },
  };
  for (const listener of runtimeCreatedListeners) listener(runtime);
  return runtime;
}

// The ambient runtime: browsers get one process-wide default so existing
// imports keep their exact behavior. Servers switch per request.
const defaultRuntime: ApplicationRuntime = {
  id: 'browser-default',
  state: createKernelState(),
  dispose() {
    throw new Error(
      '[memo-dom] the default browser runtime cannot be disposed',
    );
  },
};

let activeRuntime: ApplicationRuntime = defaultRuntime;

/** Host-installed context propagation; ordinary browser updates need none. */
export interface ApplicationRuntimeScope {
  getStore(): ApplicationRuntime | undefined;
  run<T>(runtime: ApplicationRuntime, callback: () => T): T;
}
let applicationScope: ApplicationRuntimeScope | undefined;
export function installApplicationRuntimeScope(scope: ApplicationRuntimeScope): void {
  applicationScope = scope;
}

/** The runtime all kernel operations currently route through. */
export function getActiveApplicationRuntime(): ApplicationRuntime {
  return applicationScope?.getStore() ?? activeRuntime;
}

type RuntimeCreatedListener = (runtime: ApplicationRuntime) => void;
const runtimeCreatedListeners: RuntimeCreatedListener[] = [];
const runtimeDisposedListeners: RuntimeCreatedListener[] = [];

/** @internal Drain runtime-owned asynchronous bookkeeping before stores clear. */
export function onRuntimeDisposed(listener: RuntimeCreatedListener): void {
  runtimeDisposedListeners.push(listener);
}

/** Invoke `listener` for every application runtime created from now on. */
export function onRuntimeCreated(
  listener: RuntimeCreatedListener,
): () => void {
  runtimeCreatedListeners.push(listener);
  return () => {
    const index = runtimeCreatedListeners.indexOf(listener);
    if (index >= 0) runtimeCreatedListeners.splice(index, 1);
  };
}

/** Route subsequent kernel operations through `runtime`. */
export function setActiveApplicationRuntime(
  runtime: ApplicationRuntime,
): ApplicationRuntime {
  const previous = activeRuntime;
  activeRuntime = runtime;
  return previous;
}

/** Scope `fn` to `runtime`, restoring the previous runtime afterwards. */
export function runInApplicationRuntime<T>(
  runtime: ApplicationRuntime,
  fn: () => T,
): T {
  const previous = activeRuntime;
  const invoke = () => {
    activeRuntime = runtime;
    try {
      return fn();
    } finally {
      activeRuntime = previous;
    }
  };
  return applicationScope ? applicationScope.run(runtime, invoke) : invoke();
}

/** Swap the scheduling policy of the ACTIVE runtime (tests, SSR, hosts). */
export function setScheduler(fn: Scheduler): void {
  getActiveApplicationRuntime().state.scheduler = fn;
}

/** The capability descriptor of the ACTIVE runtime. */
export function getActiveEnvironment(): RenderEnvironment {
  return getActiveApplicationRuntime().state.environment;
}

/**
 * Whether detached DOM templates may be cloned for new instances. False in
 * hydrate mode: row factories must claim their server nodes through the
 * document instead of cloning a template built from the first claim.
 */
export function canReuseTemplate(): boolean {
  return getActiveApplicationRuntime().state.environment.hydration === undefined;
}

/**
 * Run `run` in an overridden render environment (mode, document, hydration).
 * Restores the previous environment afterwards.
 */
export function runWithRenderEnvironment<T>(
  overrides: Partial<RenderEnvironment>,
  run: () => T,
): T {
  const state = getActiveApplicationRuntime().state;
  const previous = state.environment;
  state.environment = {
    mode: overrides.mode ?? previous.mode,
    document: overrides.document ?? previous.document,
    schedule: overrides.schedule !== undefined ? overrides.schedule : previous.schedule,
    effects: overrides.effects ?? previous.effects,
    refs: overrides.refs ?? previous.refs,
    hydration: overrides.hydration ?? previous.hydration,
  };
  try {
    return run();
  } finally {
    state.environment = previous;
  }
}

/**
 * Per-runtime named storage for kernel-adjacent subsystems. The first call
 * creates the store; every later call inside the same runtime returns the
 * same instance, so concurrent runtimes never share module state.
 */
export function getExtensionStore<T>(key: string, create: () => T): T {
  const extensions = getActiveApplicationRuntime().state.extensions;
  const existing = extensions.get(key);
  if (existing !== undefined) return existing as T;
  const created = create();
  extensions.set(key, created);
  return created;
}

export function resetScheduler(): void {
  getActiveApplicationRuntime().state.scheduler = defaultScheduler;
}

// ---------------------------------------------------------------------------
// Registry-change listeners and disposal hooks are STATIC infrastructure —
// they are installed once per process (access resolver, cleanup module) and
// carry no per-request state themselves. Per-request stores live on the
// ApplicationRuntime instead.
// ---------------------------------------------------------------------------

type RegistryListener = (id: EntityId, kind: 'add' | 'remove') => void;
const registryListeners: RegistryListener[] = [];

/**
 * Lifecycle features install their disposer lazily on first use. Keeping the
 * kernel independent of cleanup/effect/ref modules lets applications that do
 * not use those features tree-shake their storage and disposal machinery.
 */
export type EntityDisposeHook = (id: EntityId) => readonly unknown[] | void;
const entityDisposeHooks: EntityDisposeHook[] = [];

/** @internal Observe the end of a scheduled render drain, including failure. */
const commitFinishedListeners: Array<(failed: boolean, error?: unknown) => void> = [];
export function onCommitFinished(listener: (failed: boolean, error?: unknown) => void): void {
  commitFinishedListeners.push(listener);
}

export function onEntityDispose(fn: EntityDisposeHook): void {
  if (!entityDisposeHooks.includes(fn)) entityDisposeHooks.push(fn);
}

export function onRegistryChange(fn: RegistryListener): void {
  registryListeners.push(fn);
}

function notifyRegistry(id: EntityId, kind: 'add' | 'remove'): void {
  for (const fn of registryListeners) fn(id, kind);
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

/** Current registry generation (introspection/resolver only). */
export function registryGeneration(): number {
  return getActiveApplicationRuntime().state.generation;
}

/** Compiler-known entity registration; polling is selected by its emitter. */
export function registerEntity(entity: Entity): void {
  const runtime = getActiveApplicationRuntime();
  const k = runtime.state;
  const parent =
    entity.parent !== null ? k.registry.get(entity.parent) : undefined;
  const preparation = k.preparation ?? parent?.preparation;
  preparation?.attach(entity);
  // any reader renders); else derive from the parent — string scan fallback
  entity.depth =
    entity.depth ??
    (parent && parent.depth !== undefined ? parent.depth + 1 : depthOf(entity.id));
  k.registry.set(entity.id, entity);

  if (parent) {
    (parent.children ??= new Set()).add(entity.id);
  }

  k.idsCache = null;
  k.generation++;
  notifyRegistry(entity.id, 'add');
}

/**
 * Unregister an entity and ALL its descendants — O(subtree), not O(registry).
 * Walks the children links; also detaches from the parent's children set.
 */
export function unregisterSubtree(id: EntityId): void {
  unregisterSubtreeInState(getActiveApplicationRuntime().state, id);
}

function unregisterSubtreeInState(k: KernelState, id: EntityId): void {
  const root = k.registry.get(id);
  if (!root) return;

  if (root.parent !== null) {
    k.registry.get(root.parent)?.children?.delete(id);
  }

  // Re-read after detaching: a parent child-link accessor may change the registry.
  const currentRoot = k.registry.get(id);
  const children = currentRoot?.children;
  if (currentRoot !== undefined && children === undefined) {
    // Most registered rows have no descendants. Preserve ordinary disposal
    // without allocating a traversal stack, teardown list or empty error list.
    k.generation++;
    removeRegisteredEntity(k, id);
    reportCleanupErrors(disposeEntity(id, null), id);
    return;
  }

  const stack: EntityId[] = [];
  const teardown: EntityId[] = [];
  if (currentRoot !== undefined) {
    teardown.push(id);
    // Keep the original truthy-check and iteration reads, including accessors.
    if (children) for (const child of currentRoot.children!) stack.push(child);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const e = k.registry.get(cur);
    if (!e) continue;
    teardown.push(cur);
    if (e.children) {
      for (const c of e.children) stack.push(c);
    }
  }

  // Children leave before their owners. Remove the complete subtree from the
  // live registry before invoking user teardown so reentrant invalidation and
  // unregister calls become dead letters.
  teardown.reverse();
  k.generation++;
  k.idsCache = null;
  for (const cur of teardown) {
    removeRegisteredEntity(k, cur);
  }
  let cleanupErrors: unknown[] | null = null;
  for (const cur of teardown) {
    cleanupErrors = disposeEntity(cur, cleanupErrors);
  }
  reportCleanupErrors(cleanupErrors, id);
}

function removeRegisteredEntity(k: KernelState, id: EntityId): void {
  k.registry.delete(id);
  k.dirty.delete(id);
  clearDirtyReasons(k.dirtyReasons, id);
  // A registry listener can repopulate this cache after each removal. Clear
  // it again before the next notification, not after user cleanup has run.
  k.idsCache = null;
  notifyRegistry(id, 'remove');
}

function disposeEntity(id: EntityId, cleanupErrors: unknown[] | null): unknown[] | null {
  for (const dispose of entityDisposeHooks) {
    const errors = dispose(id);
    if (errors !== undefined) for (const error of errors) (cleanupErrors ??= []).push(error);
  }
  return cleanupErrors;
}

function reportCleanupErrors(cleanupErrors: unknown[] | null, id: EntityId): void {
  if (cleanupErrors === null) return;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      `[memo-dom] ${cleanupErrors.length} cleanup disposers failed while unregistering '${id}'`,
    );
  }
}

/** Single-id unregister takes its subtree with it — same thing. */
export function unregister(id: EntityId): void {
  unregisterSubtree(id);
}

export function has(id: EntityId): boolean {
  return getActiveApplicationRuntime().state.registry.has(id);
}

export function getEntity(id: EntityId): Entity | undefined {
  return getActiveApplicationRuntime().state.registry.get(id);
}
/**
 * Render the already-mounted descendants of one compiler-owned structural
 * entity, parent before child, and cancel duplicate scheduled renders.
 * Render-callback rows use this when their JSX contains component entities
 * whose lexical dependencies belong to the callback caller.
 */
export function renderDescendants(id: EntityId): void {
  const k = getActiveApplicationRuntime().state;
  const visitRenderPhase = (parent: Entity): void => {
    if (parent.children === undefined) return;
    for (const childId of parent.children) {
      const child = k.registry.get(childId);
      if (child === undefined) continue;
      if (child.phase !== 'effect') {
        child.render();
        undirty(childId);
      }
      visitRenderPhase(child);
    }
  };
  const visitEffectPhase = (parent: Entity): void => {
    if (parent.children === undefined) return;
    for (const childId of parent.children) {
      const child = k.registry.get(childId);
      if (child === undefined) continue;
      if (child.phase === 'effect') {
        child.render();
        undirty(childId);
      }
      visitEffectPhase(child);
    }
  };
  const owner = k.registry.get(id);
  if (owner !== undefined) {
    visitRenderPhase(owner);
    visitEffectPhase(owner);
  }
}

export function registeredIds(): readonly EntityId[] {
  const k = getActiveApplicationRuntime().state;
  k.idsCache ??= [...k.registry.keys()];
  return k.idsCache;
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------
/**
 * Mark one entity dirty and schedule a commit.
 *
 * Dead letters (spec §9.7): marking an unmounted id is a silent no-op.
 * Exact causes use the optional adapter; full owner writes need no merger.
 */
export function invalidateEntity(id: EntityId): void {
  enqueueEntityInvalidation(id);
}

type DirtyReasonMerger = (store: DirtyReasonStore, id: EntityId, wasDirty: boolean, reason: DirtyReasonInput) => void;

/** @internal Exact invalidation entry used by the optional cause adapter. */
export function enqueueEntityInvalidation(
  id: EntityId,
  reason?: DirtyReasonInput,
  merge?: DirtyReasonMerger,
): void {
  const runtime = getActiveApplicationRuntime();
  if (enqueueDirty(runtime.state, id, reason, merge)) scheduleCommit(runtime);
}

/** @internal Enqueue a resolved write's readers before a synchronous commit. */
export function enqueueEntityInvalidations(ids: readonly EntityId[], reason?: DirtyReasonInput, merge?: DirtyReasonMerger): void {
  if (ids.length === 0) return;
  const runtime = getActiveApplicationRuntime();
  const k = runtime.state;
  let marked = false;
  for (const id of ids) {
    if (enqueueDirty(k, id, reason, merge)) marked = true;
  }
  if (marked) scheduleCommit(runtime);
}

function enqueueDirty(k: KernelState, id: EntityId, reason?: DirtyReasonInput, merge?: DirtyReasonMerger): boolean {
  if (!k.registry.has(id)) return false;
  if (k.inCommit && k.markedBy !== null && k.renderingEntity !== null) {
    k.markedBy.set(id, k.renderingEntity);
  }
  const wasDirty = k.dirty.has(id);
  if (reason !== undefined) merge!(k.dirtyReasons, id, wasDirty, reason);
  else if (wasDirty) clearDirtyReasons(k.dirtyReasons, id);
  k.dirty.add(id);
  return true;
}

/**
 * Cancel a pending dirty (M5.7): a list row that just rendered through the
 * reconcile resync (M5.5 entry.update) must not render a second, identical
 * time when the commit batch reaches it. Only removes a PENDING entry —
 * if the row is re-dirtied later (cascade), it renders again as usual.
 */
export function undirty(id: EntityId): void {
  const k = getActiveApplicationRuntime().state;
  // size gate first: rows are undirtied on EVERY reconcile resync (M5.7)
  // while almost never actually pending — skip the string hash lookup then
  if (k.dirty.size !== 0 && k.dirty.delete(id)) {
    clearDirtyReasons(k.dirtyReasons, id);
  }
}

/**
 * Mark an entity and ALL its descendants dirty — the fallback for an
 * unbounded effect (spec §4.4). Equivalent to re-rendering from the mounted
 * root: correct under any circumstance, just not scoped.
 *
 * NOTE: prefix scan (rare fallback path); teardown uses the children links.
 * The compiler may include an exact owner destination. Enqueue it before the
 * subtree so even synchronous schedulers commit both publications together.
 * Owners outside the fallback root retain their supplied reasons.
 */
export function enqueueSubtreeInvalidation(
  id: EntityId,
  ownerId?: EntityId,
  ownerReason?: DirtyReasonInput,
  merge?: DirtyReasonMerger,
): void {
  const runtime = getActiveApplicationRuntime();
  const k = runtime.state;
  const prefix = id + '/';
  let marked = ownerId !== undefined && enqueueDirty(k, ownerId, ownerReason, merge);
  for (const key of k.registry.keys()) {
    if (key === id || key.startsWith(prefix)) {
      k.dirty.add(key);
      clearDirtyReasons(k.dirtyReasons, key);
      marked = true;
    }
  }
  if (marked) scheduleCommit(runtime);
}

function scheduleCommit(runtime: ApplicationRuntime): void {
  const k = runtime.state;
  if (k.scheduled || k.inCommit) return; // dedupe: 1000 marks → 1 frame
  k.scheduled = true;
  k.scheduler(() => runInApplicationRuntime(runtime, commit));
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
 * microtask scheduler, `markDirty`/`commitWrites` only SCHEDULE a commit; call
 * `commit()` to run it synchronously (tests, boundary integrations where a
 * host requires synchronous DOM, e.g. the dom-reconciler-bench contract).
 * Prefer `setScheduler(fn => fn())` when the WHOLE app should be sync.
 */
export function commit(): void {
  const k = getActiveApplicationRuntime().state;
  k.scheduled = false;
  if (k.inCommit) return; // reentrancy: the running drain picks up new marks
  k.inCommit = true;
  k.renderCounts ??= new Map();
  k.markedBy ??= new Map();
  let failed = false;
  let failure: unknown;
  let renderErrors: unknown[] | null = null;
  let failedEntities: Set<Entity> | null = null;
  const blockedByFailure = (entity: Entity): boolean => {
    if (failedEntities === null) return false;
    let current: Entity | undefined = entity;
    while (current !== undefined) {
      if (failedEntities.has(current)) return true;
      current = current.parent === null ? undefined : k.registry.get(current.parent);
    }
    return false;
  };
  try {
    // R10: drain loop — renders may mark further ids (setProps pushing props
    // to children, update-driven invalidation). Depth-sorted batches keep
    // parent-before-child within and across passes. A bound guards cycles.
    for (let pass = 0; pass < MAX_COMMIT_PASSES && k.dirty.size > 0; pass++) {
      // M5.7: keep ids IN the dirty set until the moment they render —
      // a render that runs earlier in this batch (parent list reconcile →
      // M5.5 row resync) may cancel a row's pending render via undirty().
      const pending: Entity[] = [];
      for (const id of k.dirty) {
        const e = k.registry.get(id);
        if (e) {
          if (failedEntities === null || !blockedByFailure(e)) pending.push(e);
        }
        else {
          k.dirty.delete(id); // dead letter: dirtied, then unregistered
          clearDirtyReasons(k.dirtyReasons, id);
        }
      }

      // Render/computed work always drains before side effects. This gives
      // effects a coherent post-DOM view even when parent renders cascade
      // prop updates into deeper children over several drain passes.
      const hasRenderWork = pending.some((e) => e.phase !== 'effect');
      // Complete independent render work after a failure, but defer effects:
      // they require a coherent post-DOM view. Failed branches retry only on
      // a later externally scheduled commit, never repeatedly in this drain.
      if (renderErrors !== null && !hasRenderWork) break;
      const batch = hasRenderWork
        ? pending.filter((e) => e.phase !== 'effect')
        : pending;
      batch.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

      for (const e of batch) {
        if (k.registry.get(e.id) !== e || failedEntities !== null && blockedByFailure(e)) continue;
        if (k.dirty.delete(e.id)) {
          const renders = (k.renderCounts!.get(e.id) ?? 0) + 1;
          k.renderCounts!.set(e.id, renders);
          if (renders > MAX_ENTITY_RENDERS_PER_COMMIT) {
            const culprits = new Map<EntityId, number>();
            for (const [marked, marker] of k.markedBy!) {
              const markedRenders = k.renderCounts!.get(marked) ?? 0;
              if (marked === e.id || markedRenders > 1) {
                culprits.set(marker, (culprits.get(marker) ?? 0) + 1);
              }
            }
            const trail = [...culprits]
              .sort((x, y) => y[1] - x[1])
              .slice(0, 5)
              .map(([marker, count]) => `${marker} (${count} marks)`)
              .join(', ');
            throw new Error(
              `[memo-dom] entity '${e.id}' rendered ${renders} times within a single commit — a render cycle involves it. ` +
                `Entities that marked it or its participants during this commit: ${trail || 'unknown'}. ` +
                `An effect likely writes state its own owner's update re-reads.`,
            );
          }
          k.renderingEntity = e.id;
          try {
            e.render(takeDirtyReasons(k.dirtyReasons, e.id));
          } catch (error) {
            // A partial render may have stopped before some dependent slots.
            // Keep a full dirty mark for the next commit; a later pull/write
            // must not discard the consumed cause and leave those slots stale.
            // Effects retain their normal failure semantics, and teardown or
            // replacement during the failed render must not revive this entity.
            if (e.phase !== 'effect' && k.registry.get(e.id) === e) {
              k.dirty.add(e.id);
              clearDirtyReasons(k.dirtyReasons, e.id);
            }
            if (e.phase === 'effect') throw error;
            (failedEntities ??= new Set()).add(e);
            (renderErrors ??= []).push(error);
          } finally {
            k.renderingEntity = null;
          }
        }
      }
      // ids dirtied DURING renders (cascade) stay in the set → next pass
    }
    if (renderErrors !== null) {
      if (renderErrors.length === 1) throw renderErrors[0];
      throw new AggregateError(renderErrors, '[memo-dom] independent renders failed');
    }
    if (k.dirty.size > 0) {
      throw new Error(
        '[memo-dom] commit cascade exceeded 100 passes — an update is dirtying its own readers (cycle)',
      );
    }
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    k.inCommit = false;
    k.renderingEntity = null;
    k.renderCounts = null;
    k.markedBy = null;
    for (const listener of commitFinishedListeners) listener(failed, failure);
  }
}

// ---------------------------------------------------------------------------
// Introspection (tests / devtools only — not part of the paradigm surface)
// ---------------------------------------------------------------------------
export function _internals(): {
  registry: ReadonlyMap<EntityId, Entity>;
  dirtySet: ReadonlySet<EntityId>;
  volatileSet: ReadonlySet<EntityId>;
} {
  const k = getActiveApplicationRuntime().state;
  const volatile = k.extensions.get('mmd:volatile') as { ids: Set<EntityId> } | undefined;
  return { registry: k.registry, dirtySet: k.dirty, volatileSet: volatile?.ids ?? new Set() };
}

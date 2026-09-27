/** Compiler-owned atomic range: staged discovery, adoption and owned retry. */
import { getActiveApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import { createRenderPreparation, type RenderPreparation } from './preparation';
import type { CondEntry } from './cond';
import type { DirtyReasons } from './dirty-reasons';
import { HydrationMismatchError } from './hydration-error';

/** @internal Factories return compiler-owned entries, never authored JSX. */
export function createPreparedRegion(
  parent: Node,
  id: string,
  create: () => CondEntry,
  pending?: () => CondEntry,
  error?: (cause: unknown, retry: () => Promise<void>) => CondEntry,
) {
  const runtime = getActiveApplicationRuntime();
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const environment = getActiveEnvironment();
  const controller = environment.hydration;
  const adopted = controller?.claimRange('g', id);
  const open = adopted?.open ?? environment.document.createComment(`mmd:g:${id}`);
  const end = adopted?.end ?? environment.document.createComment('/mmd');
  if (adopted === undefined) { parent.appendChild(open); parent.appendChild(end); }
  else controller!.recordFragmentRange(parent, adopted);
  let preserveAdopted = adopted !== undefined;
  const clear = () => {
    if (open.parentNode === null || open.parentNode !== end.parentNode) return;
    while (open.nextSibling !== null && open.nextSibling !== end) open.parentNode.removeChild(open.nextSibling);
  };
  const createContent = () => {
    if (!preserveAdopted) return create();
    controller!.pushRange(adopted!);
    try {
      const entry = create();
      controller!.popRange();
      return entry;
    } catch (cause) {
      try { controller!.popRange(); } catch { /* Preserve the primary mismatch. */ }
      throw cause;
    }
  };
  // The outer uncommitted generation owns first-mount readiness and lifecycle.
  const enclosing = runtime.state.preparation as RenderPreparation | undefined;
  if (enclosing !== undefined) {
    let entry: CondEntry;
    try {
      entry = createContent();
      if (!preserveAdopted) for (const node of entry.nodes) end.parentNode!.insertBefore(node, end);
    } catch (cause) {
      if (!preserveAdopted) { clear(); open.parentNode?.removeChild(open); end.parentNode?.removeChild(end); }
      throw cause;
    }
    preserveAdopted = false;
    let disposed = false;
    return {
      get status() { return disposed ? 'disposed' as const : 'active' as const; },
      get error(): unknown { return undefined; },
      update(reasons: DirtyReasons = null) {
        if (!disposed) enclosing.run(() => entry.update(reasons));
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        inRuntime(() => {
          try { entry.dispose?.(); }
          finally { clear(); open.parentNode?.removeChild(open); end.parentNode?.removeChild(end); }
        });
      },
    };
  }
  let preparation: RenderPreparation;
  let detached: DocumentFragment;
  let content: CondEntry | undefined;
  let fallback: CondEntry | undefined;
  let state: 'pending' | 'active' | 'error' | 'disposed' = 'pending';
  const hasFailed = () => state === 'error';
  let failure: unknown;
  let unsubscribe = () => {};
  let generation = 0;
  let retrying: Promise<void> | undefined;
  let resolveReady = () => {};
  let rejectReady = (_cause: unknown) => {};
  let readiness: Promise<void>;
  const release = (releases: Array<() => void>) => {
    const failures: unknown[] = [];
    for (const run of releases) {
      try { run(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, '[memo-dom] atomic range cleanup failed');
  };
  const releaseContent = () => {
    const previous = content;
    content = undefined;
    // Capture failed borrowed adapters before entry cleanup releases read claims.
    release([() => preparation.dispose(), () => previous?.dispose?.(), () => {
      while (detached.firstChild !== null) detached.removeChild(detached.firstChild);
    }]);
  };
  const releaseFallback = () => {
    const previous = fallback;
    fallback = undefined;
    previous?.dispose?.();
  };
  const fail = (cause: unknown) => inRuntime(() => {
    if (state === 'disposed' || state === 'error') return;
    state = 'error';
    failure = cause;
    unsubscribe();
    try { releaseContent(); }
    catch (cleanup) { failure = new AggregateError([cause, cleanup], '[memo-dom] atomic render and rollback failed'); }
    rejectReady(failure);
    // Cursor/mismatch failures belong to mount recovery, never to Group UI.
    if (preserveAdopted || cause instanceof HydrationMismatchError) throw failure;
    releaseFallback();
    clear();
    if (error === undefined) throw failure;
    // A failed error renderer escapes rather than selecting itself recursively.
    const token = generation;
    fallback = error(failure, () => token === generation ? retry() : Promise.resolve());
    for (const node of fallback.nodes) end.parentNode!.insertBefore(node, end);
  });
  const check = () => {
    if (state !== 'pending') return;
    if (preparation.status === 'disposed') { dispose(); return; }
    if (preparation.readiness === 'error') { fail(preparation.errors[0]); return; }
    if (preparation.readiness !== 'ready') return;
    releaseFallback();
    if (!preserveAdopted) { clear(); end.parentNode!.insertBefore(detached, end); }
    state = 'active';
    unsubscribe();
    const token = generation;
    // The surrounding compiler factory may still be initializing its closures.
    queueMicrotask(() => inRuntime(() => {
      if (token !== generation || state !== 'active') return;
      try { preparation.activate(); resolveReady(); }
      catch (cause) {
        if (preparation.status === 'active') { rejectReady(cause); throw cause; }
        fail(cause);
      }
    }));
  };
  function start() {
    state = 'pending';
    failure = undefined;
    generation++;
    readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Navigation can await it; an ordinary mounted boundary need not.
    void readiness.catch(() => {});
    detached = getActiveEnvironment().document.createDocumentFragment();
    preparation = createRenderPreparation(fail);
    unsubscribe = preparation.subscribe(check);
    try {
      content = preparation.run(createContent);
      if (!preserveAdopted) for (const node of content.nodes) detached.appendChild(node);
      else if (preparation.readiness !== 'ready') {
        throw new HydrationMismatchError(id, 'resolved atomic content', preparation.readiness);
      }
      check();
      preserveAdopted = false;
      if (state === 'pending' && pending !== undefined) {
        fallback = pending();
        for (const node of fallback.nodes) end.parentNode!.insertBefore(node, end);
      }
    } catch (cause) {
      if (!hasFailed()) fail(cause);
      else throw cause;
    }
  }
  function retry(): Promise<void> {
    if (state === 'disposed') return Promise.resolve();
    if (retrying !== undefined) return retrying;
    if (state !== 'error') return readiness;
    const token = generation;
    // Owned holders retire; surviving borrowed operations need explicit retry.
    retrying = Promise.resolve().then(() => inRuntime(() => {
      if (state === 'disposed' || token !== generation) return;
      void preparation.retryFailed().catch(() => {});
      releaseFallback();
      clear();
      start();
      return readiness;
    })).finally(() => { retrying = undefined; });
    void retrying.catch(() => {});
    return retrying;
  }
  function dispose() {
    if (state === 'disposed') return;
    state = 'disposed';
    generation++;
    unsubscribe();
    rejectReady(new DOMException('Atomic region was disposed', 'AbortError'));
    inRuntime(() => {
      try { release([releaseFallback, releaseContent]); }
      finally {
        if (!preserveAdopted) { clear(); open.parentNode?.removeChild(open); end.parentNode?.removeChild(end); }
      }
    });
  }
  try { start(); }
  catch (cause) {
    try { dispose(); }
    catch (cleanup) { throw new AggregateError([cause, cleanup], '[memo-dom] atomic creation and rollback failed'); }
    throw cause;
  }
  return {
    get status() { return state; },
    get error() { return failure; },
    get settled() { return readiness; },
    retry,
    update(reasons: DirtyReasons = null) {
      if (state !== 'pending' && state !== 'active') return;
      try { preparation.run(() => content?.update(reasons)); check(); }
      catch (cause) { fail(cause); }
    },
    dispose,
  };
}

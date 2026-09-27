/** Internal publication prototype. Not yet emitted for authored suspend. */
import { getActiveApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import { createRenderPreparation, type RenderPreparation } from './preparation';
import type { CondEntry } from './cond';
import type { DirtyReasons } from './dirty-reasons';
import { HydrationMismatchError } from './hydration-error';

/** @internal A range, rather than a frozen node list, owns late child output. */
export function createPreparedRegion(
  parent: Node,
  id: string,
  create: () => CondEntry,
  pending?: () => CondEntry,
) {
  const runtime = getActiveApplicationRuntime();
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const environment = getActiveEnvironment();
  const document = environment.document;
  const controller = environment.hydration;
  const adopted = controller?.claimRange('g', id);
  const open = adopted?.open ?? document.createComment(`mmd:g:${id}`);
  const end = adopted?.end ?? document.createComment('/mmd');
  if (adopted === undefined) {
    parent.appendChild(open);
    parent.appendChild(end);
  } else {
    controller!.recordFragmentRange(parent, adopted);
  }
  // Adoption validates the server range without moving it into private DOM.
  // Failed adoption must leave that DOM intact for mount's recovery policy.
  let preserveAdopted = adopted !== undefined;
  const createContent = () => {
    if (adopted === undefined) return create();
    controller!.pushRange(adopted);
    try {
      const entry = create();
      controller!.popRange();
      return entry;
    } catch (error) {
      // A mismatch in creation is more useful than an unfinished cursor.
      try { controller!.popRange(); } catch { /* Preserve the primary error. */ }
      throw error;
    }
  };
  const detached = document.createDocumentFragment();
  // An uncommitted outer boundary owns the whole discovery tree. Nested
  // markers must not introduce independent fallback or activation milestones.
  const enclosing = runtime.state.preparation as RenderPreparation | undefined;
  if (enclosing !== undefined) {
    let entry: CondEntry;
    try {
      entry = createContent();
      if (adopted === undefined) {
        for (const node of entry.nodes) end.parentNode!.insertBefore(node, end);
      }
    } catch (error) {
      if (!preserveAdopted) { open.remove(); end.parentNode?.removeChild(end); }
      throw error;
    }
    let disposed = false;
    preserveAdopted = false;
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
          finally {
            while (open.nextSibling !== null && open.nextSibling !== end) open.nextSibling.remove();
            open.remove(); end.parentNode?.removeChild(end);
          }
        });
      },
    };
  }
  const preparation = createRenderPreparation();
  let content: CondEntry | undefined;
  let fallback: CondEntry | undefined;
  let state: 'pending' | 'active' | 'error' | 'disposed' = 'pending';
  let failure: unknown;
  let unsubscribe = () => {};
  const clear = () => {
    while (open.nextSibling !== null && open.nextSibling !== end) open.nextSibling.remove();
  };
  const check = () => {
    if (state !== 'pending') return;
    if (preparation.status === 'disposed') { dispose(); return; }
    if (preparation.readiness === 'error') {
      failure = preparation.errors[0];
      state = 'error';
      unsubscribe();
      return;
    }
    if (preparation.readiness !== 'ready') return;
    if (adopted !== undefined && preserveAdopted) {
      state = 'active';
      unsubscribe();
      preparation.activate();
      return;
    }
    fallback?.dispose?.();
    fallback = undefined;
    clear();
    // Move the current detached range, including child nodes discovered after
    // creation. The factory's original nodes[] is not a publication snapshot.
    end.parentNode!.insertBefore(detached, end);
    state = 'active';
    unsubscribe();
    preparation.activate();
  };
  function dispose(): void {
    if (state === 'disposed') return;
    state = 'disposed';
    unsubscribe();
    const errors: unknown[] = [];
    inRuntime(() => {
      for (const release of [() => fallback?.dispose?.(), () => content?.dispose?.(), () => preparation.dispose()]) {
        try { release(); } catch (error) { errors.push(error); }
      }
      if (!preserveAdopted) { clear(); open.remove(); end.parentNode?.removeChild(end); }
    });
    detached.replaceChildren();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '[memo-dom] prepared region cleanup failed');
  }
  unsubscribe = preparation.subscribe(check);
  try {
    content = preparation.run(createContent);
    if (adopted === undefined) detached.append(...content.nodes);
    else if (preparation.readiness !== 'ready') {
      throw new HydrationMismatchError(id, 'resolved atomic content', preparation.readiness);
    }
    check();
    preserveAdopted = false;
    if (state === 'pending' && pending !== undefined) {
      fallback = pending();
      for (const node of fallback.nodes) end.parentNode!.insertBefore(node, end);
    }
  } catch (error) {
    // Effect exceptions after successful activation remain mounted errors.
    if (preparation.status === 'active') throw error;
    try { dispose(); }
    catch (rollback) { throw new AggregateError([error, rollback], '[memo-dom] prepared region and rollback failed'); }
    throw error;
  }
  return {
    get status() { return state; },
    get error() { return failure; },
    update(reasons: DirtyReasons = null) {
      if (state === 'pending' || state === 'active') {
        preparation.run(() => content?.update(reasons));
        check();
      }
    },
    dispose,
  };
}

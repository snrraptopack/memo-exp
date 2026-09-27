/** Internal publication prototype. Not yet emitted for authored suspend. */
import { getActiveApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import { createRenderPreparation } from './preparation';
import type { CondEntry } from './cond';

/** @internal A range, rather than a frozen node list, owns late child output. */
export function createPreparedRegion(
  parent: Node,
  create: () => CondEntry,
  pending?: () => CondEntry,
) {
  const runtime = getActiveApplicationRuntime();
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const document = getActiveEnvironment().document;
  const open = document.createComment('mmd:preparing');
  const end = document.createComment('/mmd');
  parent.appendChild(open);
  parent.appendChild(end);
  const detached = document.createDocumentFragment();
  // An uncommitted outer boundary owns the whole discovery tree. Nested
  // markers must not introduce independent fallback or activation milestones.
  if (runtime.state.preparation !== undefined) {
    let entry: CondEntry;
    try {
      entry = create();
      for (const node of entry.nodes) end.parentNode!.insertBefore(node, end);
    } catch (error) {
      open.remove();
      end.remove();
      throw error;
    }
    let disposed = false;
    return {
      get status() { return disposed ? 'disposed' as const : 'active' as const; },
      get error(): unknown { return undefined; },
      dispose() {
        if (disposed) return;
        disposed = true;
        inRuntime(() => {
          try { entry.dispose?.(); }
          finally {
            while (open.nextSibling !== null && open.nextSibling !== end) open.nextSibling.remove();
            open.remove(); end.remove();
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
      clear();
      open.remove();
      end.remove();
    });
    detached.replaceChildren();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, '[memo-dom] prepared region cleanup failed');
  }
  unsubscribe = preparation.subscribe(check);
  try {
    content = preparation.run(create);
    detached.append(...content.nodes);
    check();
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
    dispose,
  };
}

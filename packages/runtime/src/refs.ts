/**
 * refs.ts - mount-only DOM ref callbacks with deterministic teardown.
 *
 * Assignable refs are compiled into this callback contract, so the runtime
 * never needs to understand source l-values or allocate JSX/ref objects.
 *
 * Ref invocation is capability-gated (SSR slice 1.2): server environments
 * record ownership without handing over nodes.
 *
 * mountRef runs during element creation — before insertion in create mode
 * and before the document settles during hydration — so callbacks are
 * split into two classes: compiler-emitted assign adapters (`refAssign`)
 * are pure writes and stay synchronous, while authored callbacks defer
 * until the node is connected inside a settled document. Without that
 * deferral connection-dependent work (focus, measurement, scrolling)
 * either no-ops on a detached node or loses the browser's load-time focus
 * processing.
 */

import { getActiveEnvironment } from './kernel';

export type RefCallback<T extends Node = Node> = (
  node: T,
) => void | (() => void);
export type RefValue<T extends Node = Node> =
  | RefCallback<T>
  | readonly RefValue<T>[]
  | null
  | undefined
  | false;

/** Flags compiler-emitted assignable-target adapters as creation-time safe. */
const REF_ASSIGN = Symbol('memo-dom.refAssign');

/**
 * Mark a compiler-emitted adapter that only assigns its node to a source
 * target. Assignment needs no connected document, so it stays synchronous.
 */
export function refAssign<T extends Node>(
  assign: RefCallback<T>,
): RefCallback<T> {
  (assign as RefCallback<T> & { [REF_ASSIGN]?: true })[REF_ASSIGN] = true;
  return assign;
}

/** Mount refs left-to-right and return one idempotent reverse-order disposer. */
export function mountRef<T extends Node>(
  node: T,
  value: RefValue<T>,
): () => void {
  // Server rendering records ownership but never invokes ref callbacks:
  // there is no attached browser node to hand over. 'defer' will replay
  // refs after hydration adoption (Phase 3); until then it behaves as
  // disabled.
  if (getActiveEnvironment().refs !== 'run') {
    return () => {};
  }

  const eager: RefValue<T>[] = [];
  const deferred: RefValue<T>[] = [];
  splitRefs(value, eager, deferred);

  const disposers: Array<() => void> = [];
  let active = true;
  let mounted = false;

  const run = (entries: RefValue<T>[]): void => {
    try {
      for (const entry of entries) mountValue(node, entry, disposers);
    } catch (error) {
      const rollbackErrors = drain(disposers);
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          '[memo-dom] ref setup and rollback failed',
        );
      }
      throw error;
    }
  };

  run(eager);

  if (deferred.length > 0) {
    const runDeferred = (): void => {
      if (!active || mounted) return;
      mounted = true;
      run(deferred);
    };
    if (isLive(node)) {
      runDeferred();
    } else {
      scheduleLive(node, runDeferred);
    }
  }

  return () => {
    if (!active) return;
    active = false;
    const errors = drain(disposers);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, '[memo-dom] multiple ref cleanups failed');
    }
  };
}

/** A live node: connected to a document that has finished loading. */
function isLive(node: Node): boolean {
  return node.isConnected && documentSettled(node.ownerDocument);
}

function documentSettled(document_: Document | null): boolean {
  return document_ === null || document_.readyState === 'complete';
}

/**
 * Invoke `run` once the node is connected inside a settled document.
 * Insertion is synchronous with creation, so a microtask suffices after
 * load; during initial load the browser re-processes focus when the
 * document completes, so callbacks wait for `window.load` first.
 */
function scheduleLive(node: Node, run: () => void): void {
  const document_ = node.ownerDocument as Document | null;
  const flush = (): void => {
    if (node.isConnected) {
      run();
      return;
    }
    // Insertion normally completes in the same task; allow one frame of
    // slack for callers that defer it, then give up on the element.
    const view = document_?.defaultView;
    const raf = view?.requestAnimationFrame;
    if (raf !== undefined) {
      raf.call(view, () => {
        if (node.isConnected) run();
      });
    }
  };
  if (documentSettled(document_)) {
    queueMicrotask(flush);
    return;
  }
  const view = document_?.defaultView;
  if (view === null || view === undefined) {
    queueMicrotask(flush);
    return;
  }
  const onLoad = (): void => queueMicrotask(flush);
  view.addEventListener('load', onLoad, { once: true });
  // The document may have settled between the check and the listener.
  if (documentSettled(document_)) {
    view.removeEventListener('load', onLoad);
    queueMicrotask(flush);
  }
}

function splitRefs<T extends Node>(
  value: RefValue<T>,
  eager: RefValue<T>[],
  deferred: RefValue<T>[],
): void {
  if (value == null || value === false) return;
  if (Array.isArray(value)) {
    for (const entry of value) splitRefs(entry, eager, deferred);
    return;
  }
  if (
    typeof value === 'function' &&
    (value as { [REF_ASSIGN]?: true })[REF_ASSIGN] === true
  ) {
    eager.push(value);
  } else {
    deferred.push(value);
  }
}

function mountValue<T extends Node>(
  node: T,
  value: RefValue<T>,
  disposers: Array<() => void>,
): void {
  if (value == null || value === false) return;
  if (Array.isArray(value)) {
    for (const entry of value) mountValue(node, entry, disposers);
    return;
  }
  if (typeof value !== 'function') {
    throw new TypeError(
      '[memo-dom] ref value must be a callback, an assignable JSX target, or an array of refs',
    );
  }
  const disposer = (value as RefCallback<T>)(node);
  if (disposer == null) return;
  if (typeof disposer !== 'function') {
    throw new TypeError(
      '[memo-dom] ref callback must return a cleanup function or nothing',
    );
  }
  disposers.push(disposer);
}

function drain(disposers: Array<() => void>): unknown[] {
  const errors: unknown[] = [];
  for (let index = disposers.length - 1; index >= 0; index--) {
    try {
      disposers[index]!();
    } catch (error) {
      errors.push(error);
    }
  }
  disposers.length = 0;
  return errors;
}

/**
 * cond.ts — R8 conditional regions: anchored branch swapping.
 *
 * The mirror of list.ts for conditionals. A conditional region owns the DOM
 * between its insertion point and an anchor comment; the compiler emits one
 * per `{cond ? <A/> : <B/>}` site and registers it as an entity, so the
 * access table routes the region's variables to it — a condition write
 * dirties the region, never the whole owner.
 *
 * Branch semantics (spec §R8):
 *   - update() re-evaluates pick(). Same branch → the branch's own guarded
 *     update closure runs. Different branch → compiler-owned components and
 *     list regions drain, the old nodes are removed, and the new branch
 *     factory runs before the anchor.
 *   - A swap destroys branch-local DOM state (focus, scroll); module state
 *     survives, so re-mounting a branch reflects current state.
 */

import { getActiveEnvironment, type EntityId } from './kernel';
import type { DirtyReasons } from './dirty-reasons';

export interface CondEntry {
  /** Root nodes of the mounted branch (elements or fragment children). */
  nodes: Node[];
  /** The branch's guarded update closure. */
  update: (reasons?: DirtyReasons) => void;
  /** Drain structural regions retained by this branch before replacement. */
  dispose?: () => void;
}

export type CondBranchFactory = (adoptingInitial?: boolean) => CondEntry;

export interface CondRegion {
  /** Re-pick and re-render: same branch → guarded update; swap → rebuild. */
  update(reasons?: DirtyReasons): void;
  /** Currently mounted branch index. */
  index(): number;
  /** Drain the mounted branch and remove the stable anchor. */
  dispose(): void;
}

export function createCondRegion(
  parent: Node,
  id: EntityId,
  pick: () => number,
  branches: readonly (CondBranchFactory | null)[],
  identity?: () => unknown,
  initial?: { readonly open: Node; readonly end: Node; readonly index: number },
): CondRegion {
  // Hydration protocol (hydration-markers.md §2/§3): an opening `mmd:g`
  // marker before the branch content and a uniform `/mmd` close after it.
  // The trailing close anchor keeps its role as the stable insertion point
  // for branch swaps; empty regions emit an adjacent valid pair.
  const environment = getActiveEnvironment();
  const controller = environment.hydration;
  const adoptedRange = controller?.claimRange('g', id);
  const openAnchor =
    initial?.open ?? adoptedRange?.open ??
    environment.document.createComment(`mmd:g:${id}`);
  const anchor =
    initial?.end ?? (adoptedRange?.end as Comment | undefined) ??
    environment.document.createComment('/mmd');
  if (initial !== undefined) {
    if (openAnchor.parentNode !== parent || anchor.parentNode !== parent) {
      throw new Error('memo-dom: initial conditional anchors do not belong to their parent');
    }
  } else if (adoptedRange === undefined) {
    parent.appendChild(openAnchor);
    parent.appendChild(anchor);
  } else {
    controller!.recordFragmentRange(parent, adoptedRange);
  }
  let adopting = adoptedRange !== undefined;
  let bindingInitial = initial !== undefined;

  let current = -1;
  let currentIdentity: unknown;
  let entry: CondEntry | null = null;
  let disposed = false;

  function report(errors: unknown[]): void {
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `[memo-dom] conditional '${id}' disposal failed`);
  }

  // A child region can insert nodes after this branch's initial node snapshot.
  // The anchors, not entry.nodes, define everything this region owns.
  function clearContent(): void {
    const parent = anchor.parentNode;
    if (parent === null || openAnchor.parentNode !== parent) return;
    const disposing = disposed;
    for (let node = openAnchor.nextSibling; node !== null && node !== anchor;) {
      const next = node.nextSibling;
      parent.removeChild(node);
      if (!disposing && disposed) return;
      node = next;
    }
  }

  function update(reasons: DirtyReasons = null): void {
    if (disposed) return;
    const idx = pick();
    if (disposed) return;
    if (bindingInitial && idx !== initial!.index) {
      throw new Error('memo-dom: initial conditional selection does not match its HTML');
    }
    const nextIdentity = identity?.();
    if (disposed) return;
    if (idx === current && Object.is(nextIdentity, currentIdentity)) {
      entry?.update(reasons);
      return;
    }
    if (entry !== null) {
      const retired = entry;
      entry = null;
      current = -1;
      const errors: unknown[] = [];
      try { retired.dispose?.(); } catch (error) { errors.push(error); }
      try { clearContent(); } catch (error) { errors.push(error); }
      report(errors);
      if (disposed) return;
    }
    const factory = branches[idx] ?? null;
    if (adopting) controller!.pushRange(adoptedRange!);
    let factoryError: unknown;
    let factoryFailed = false;
    try {
      if (factory !== null) entry = bindingInitial ? factory(true) : factory();
    } catch (error) {
      factoryFailed = true;
      factoryError = error;
    }
    if (adopting) {
      if (!factoryFailed) {
        controller!.popRange();
      } else {
        // The primary mismatch error must win over cleanup diagnostics.
        try {
          controller!.popRange();
        } catch {
          // masked by factoryError
        }
      }
      adopting = false;
    }
    if (factoryFailed) throw factoryError;
    if (disposed) {
      const returned = entry;
      entry = null;
      if (returned !== null) {
        const errors: unknown[] = [];
        try { returned.dispose?.(); } catch (error) { errors.push(error); }
        for (const node of returned.nodes) {
          try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
        }
        report(errors);
      }
      return;
    }
    if (entry !== null && !bindingInitial) {
      // Every insertion is before the stable trailing anchor, so walking the
      // authored root-node order preserves that order. Reverse iteration
      // inverted multi-node fragments and list branches.
      for (let i = 0; i < entry.nodes.length; i++) {
        anchor.parentNode!.insertBefore(entry.nodes[i]!, anchor);
        if (disposed) return;
      }
    }
    current = idx;
    bindingInitial = false;
    currentIdentity = nextIdentity;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const retired = entry;
    entry = null;
    current = -1;
    const errors: unknown[] = [];
    try { retired?.dispose?.(); } catch (error) { errors.push(error); }
    try { clearContent(); } catch (error) { errors.push(error); }
    for (const node of [openAnchor, anchor]) {
      try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
    }
    report(errors);
  }

  try { update(); } // mount the initial branch
  catch (failure) {
    try { dispose(); } catch { /* Preserve the initial render failure. */ }
    throw failure;
  }

  return {
    update,
    index: () => current,
    dispose,
  };
}

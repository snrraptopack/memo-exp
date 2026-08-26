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

export interface CondEntry {
  /** Root nodes of the mounted branch (elements or fragment children). */
  nodes: Node[];
  /** The branch's guarded update closure. */
  update: () => void;
  /** Drain structural regions retained by this branch before replacement. */
  dispose?: () => void;
}

export type CondBranchFactory = () => CondEntry;

export interface CondRegion {
  /** Re-pick and re-render: same branch → guarded update; swap → rebuild. */
  update(): void;
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
): CondRegion {
  // Hydration protocol (hydration-markers.md §2/§3): an opening `mmd:g`
  // marker before the branch content and a uniform `/mmd` close after it.
  // The trailing close anchor keeps its role as the stable insertion point
  // for branch swaps; empty regions emit an adjacent valid pair.
  const environment = getActiveEnvironment();
  const controller = environment.hydration;
  const adoptedRange = controller?.claimRange('g', id);
  const openAnchor =
    adoptedRange?.open ??
    environment.document.createComment(`mmd:g:${id}`);
  const anchor =
    (adoptedRange?.end as Comment | undefined) ??
    environment.document.createComment('/mmd');
  if (adoptedRange === undefined) {
    parent.appendChild(openAnchor);
    parent.appendChild(anchor);
  }
  let adopting = adoptedRange !== undefined;

  let current = -1;
  let entry: CondEntry | null = null;

  function update(): void {
    const idx = pick();
    if (idx === current) {
      entry?.update();
      return;
    }
    if (entry !== null) {
      entry.dispose?.();
      for (const node of entry.nodes) node.parentNode?.removeChild(node);
      entry = null;
    }
    const factory = branches[idx] ?? null;
    if (adopting) controller!.pushRange(adoptedRange!);
    let factoryError: unknown;
    try {
      if (factory !== null) entry = factory();
    } catch (error) {
      factoryError = error;
    }
    if (adopting) {
      if (factoryError === undefined) {
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
    if (factoryError !== undefined) throw factoryError;
    if (entry !== null) {
      // Every insertion is before the stable trailing anchor, so walking the
      // authored root-node order preserves that order. Reverse iteration
      // inverted multi-node fragments and list branches.
      for (let i = 0; i < entry.nodes.length; i++) {
        anchor.parentNode!.insertBefore(entry.nodes[i]!, anchor);
      }
    }
    current = idx;
  }

  function dispose(): void {
    if (entry !== null) {
      entry.dispose?.();
      for (const node of entry.nodes) node.parentNode?.removeChild(node);
      entry = null;
    }
    openAnchor.parentNode?.removeChild(openAnchor);
    anchor.parentNode?.removeChild(anchor);
    current = -1;
  }

  update(); // mount the initial branch

  return {
    update,
    index: () => current,
    dispose,
  };
}

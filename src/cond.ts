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
 *     update closure runs. Different branch → the old branch's nodes are
 *     REMOVED (L1: branches are not entities, nothing to unregister) and the
 *     new branch factory runs, inserting before the anchor.
 *   - A swap destroys branch-local DOM state (focus, scroll); module state
 *     survives, so re-mounting a branch reflects current state.
 */

import type { EntityId } from './kernel';

export interface CondEntry {
  /** Root nodes of the mounted branch (L1: exactly one). */
  nodes: Node[];
  /** The branch's guarded update closure. */
  update: () => void;
}

export type CondBranchFactory = () => CondEntry;

export interface CondRegion {
  /** Re-pick and re-render: same branch → guarded update; swap → rebuild. */
  update(): void;
  /** Currently mounted branch index. */
  index(): number;
}

export function createCondRegion(
  parent: Node,
  id: EntityId,
  pick: () => number,
  branches: readonly (CondBranchFactory | null)[],
): CondRegion {
  // the anchor keeps the region's place when the mounted branch is empty
  const anchor = document.createComment(`when:${id}`);
  parent.appendChild(anchor);

  let current = -1;
  let entry: CondEntry | null = null;

  function update(): void {
    const idx = pick();
    if (idx === current) {
      entry?.update();
      return;
    }
    if (entry !== null) {
      for (const node of entry.nodes) node.parentNode?.removeChild(node);
      entry = null;
    }
    const factory = branches[idx] ?? null;
    if (factory !== null) {
      entry = factory();
      for (let i = entry.nodes.length - 1; i >= 0; i--) {
        anchor.parentNode!.insertBefore(entry.nodes[i]!, anchor);
      }
    }
    current = idx;
  }

  update(); // mount the initial branch

  return {
    update,
    index: () => current,
  };
}

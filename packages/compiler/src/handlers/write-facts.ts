/** Semantic write effects; backend commit construction consumes these facts. */
export interface ScopeWrites {
  writes: Set<string>;
  /** Proven structure-only effects; overlapping content writes dominate. */
  structuralWrites: Set<string>;
  contentWrites: Set<string>;
  /** Static item indices, superseded by ordinary writes to the same source. */
  listItemWrites: Map<string, Set<number>>;
  rootFallback: boolean;
  rowLocal: boolean;
  rowOwnerLocal: boolean;
  instanceLocal: boolean;
  instanceWrites: Set<string>;
  /** Exact instance writes retain structure precision only without content effects. */
  instanceStructuralWrites: Set<string>;
  instanceContentWrites: Set<string>;
  transparentWrites: Set<string>;
  /** A write-free event still refreshes its originating update unit. */
  eventFallback: boolean;
}

export function createScopeWrites(): ScopeWrites {
  return {
    writes: new Set(),
    structuralWrites: new Set(),
    contentWrites: new Set(),
    listItemWrites: new Map(),
    rootFallback: false,
    rowLocal: false,
    rowOwnerLocal: false,
    instanceLocal: false,
    instanceWrites: new Set(),
    instanceStructuralWrites: new Set(),
    instanceContentWrites: new Set(),
    transparentWrites: new Set(),
    eventFallback: false,
  };
}

export function recordRoutedWrite(scope: ScopeWrites, source: string, structural = false): void {
  scope.writes.add(source);
  (structural ? scope.structuralWrites : scope.contentWrites).add(source);
}

export function recordInstanceWrite(scope: ScopeWrites, source: string, structural = false): void {
  scope.instanceLocal = true;
  scope.instanceWrites.add(source);
  (structural ? scope.instanceStructuralWrites : scope.instanceContentWrites).add(source);
}

/** Authored row identity and ownership, independent of generated DOM bindings. */
export interface RowWriteFacts {
  itemParam: string;
  itemPath: string[];
  keyPath: string[] | null;
  sourceKey: string;
  sourceLocal?: boolean;
  localRefresh: boolean;
}

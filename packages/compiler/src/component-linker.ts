/**
 * component-linker.ts - graph-level component placement and row-mode linking.
 *
 * Component factories are analyzed in their defining module but receive
 * runtime ids from callers. This pass turns cross-module call edges into the
 * concrete/wildcard paths used by defining-module access-table emission.
 */

import type {
  LinkedComponentPropSource,
  LinkedComponentRowUse,
} from './context';
import type {
  ComponentPropSourceRefs,
} from './components/prop-origins';
import { linkComponentPropSources } from './components/prop-linker';

export interface ComponentGraphEdge {
  target: string;
  suffix: string;
  mode: 'static' | 'row';
  keyPath?: string[] | null;
  sourceKey?: string;
  sourceLocal?: boolean;
  propSources?: ComponentPropSourceRefs;
}

export interface ComponentGraphNode {
  key: string;
  moduleId: string;
  local: string;
  edges: ComponentGraphEdge[];
}

export interface LinkedComponentGraph {
  paths: Map<string, string[]>;
  rows: Map<string, LinkedComponentRowUse[]>;
  propSources: Map<string, Map<string, LinkedComponentPropSource>>;
}

function assertAcyclic(nodes: Map<string, ComponentGraphNode>): void {
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (key: string): void => {
    if (active.has(key)) {
      throw new Error(`memo-dom: recursive cross-module component graph at '${key}'`);
    }
    if (visited.has(key)) return;
    active.add(key);
    for (const edge of nodes.get(key)?.edges ?? []) visit(edge.target);
    active.delete(key);
    visited.add(key);
  };

  for (const key of nodes.keys()) visit(key);
}

/** Compute every declaration's caller-derived paths and keyed-row metadata. */
export function linkComponentGraph(
  declarations: readonly ComponentGraphNode[],
  rootId: string,
): LinkedComponentGraph {
  const nodes = new Map(declarations.map((decl) => [decl.key, decl]));
  assertAcyclic(nodes);

  const incoming = new Map<string, Set<'static' | 'row'>>();
  const rows = new Map<string, LinkedComponentRowUse[]>();
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      if (!nodes.has(edge.target)) {
        throw new Error(
          `memo-dom: component '${node.key}' references unknown factory '${edge.target}'`,
        );
      }
      const modes = incoming.get(edge.target) ?? new Set();
      modes.add(edge.mode);
      incoming.set(edge.target, modes);
      if (edge.mode === 'row') {
        const uses = rows.get(edge.target) ?? [];
        uses.push({
          keyPath: edge.keyPath === undefined || edge.keyPath === null
            ? null
            : [...edge.keyPath],
          sourceKey: edge.sourceKey ?? '',
          sourceLocal: edge.sourceLocal ?? false,
        });
        rows.set(edge.target, uses);
      }
    }
  }

  for (const [key, modes] of incoming) {
    if (modes.size > 1) {
      throw new Error(
        `memo-dom: component '${key}' is used both as a keyed row and a static child`,
      );
    }
  }

  const pathSets = new Map<string, Set<string>>();
  const roots = [...nodes.keys()].filter((key) => !incoming.has(key));
  for (const key of roots) pathSets.set(key, new Set([rootId]));

  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.shift()!;
    const parentPaths = pathSets.get(key);
    if (parentPaths === undefined) continue;
    for (const edge of nodes.get(key)?.edges ?? []) {
      const targetPaths = pathSets.get(edge.target) ?? new Set<string>();
      const before = targetPaths.size;
      for (const parentPath of parentPaths) {
        targetPaths.add(`${parentPath}${edge.suffix}`);
      }
      pathSets.set(edge.target, targetPaths);
      if (targetPaths.size !== before) pending.push(edge.target);
    }
  }

  const paths = new Map<string, string[]>();
  for (const key of nodes.keys()) {
    paths.set(key, [...(pathSets.get(key) ?? [])].sort());
  }

  const propSources = linkComponentPropSources(nodes, roots);
  return { paths, rows, propSources };
}

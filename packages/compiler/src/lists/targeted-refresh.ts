import * as t from '@babel/types';
import type { MapSite } from './map-site';

const EQUALITY_OPERATORS = new Set(['==', '===']);

function walkVisual(
  node: t.Node,
  parent: t.Node | null,
  visit: (node: t.Node, parent: t.Node | null) => void,
): void {
  visit(node, parent);
  if (t.isFunction(node)) return;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as any)[key] as t.Node | t.Node[] | null | undefined;
    if (Array.isArray(child)) {
      for (const item of child) if (item) walkVisual(item, node, visit);
    } else if (child) {
      walkVisual(child, node, visit);
    }
  }
}

function comparisonFor(
  identifier: t.Identifier,
  parent: t.Node | null,
  key: t.Expression,
): boolean {
  if (
    !t.isBinaryExpression(parent) ||
    !EQUALITY_OPERATORS.has(parent.operator)
  ) {
    return false;
  }
  const other = parent.left === identifier ? parent.right : parent.left;
  return t.isExpression(other) && t.isNodesEquivalent(other, key);
}

/**
 * Finds instance-state values that affect exactly the row keyed by that value.
 * Every visual reference must be an equality comparison with the authored key;
 * mixed/general uses are rejected and retain full-list reconciliation.
 */
export function findTargetedListDependencies(
  site: MapSite,
  instanceState: ReadonlySet<string>,
): string[] {
  if (
    site.jsx === null ||
    site.keyExpr === null ||
    !site.sourceLocal ||
    !t.isIdentifier(site.sourceExpr) ||
    !instanceState.has(site.sourceExpr.name)
  ) {
    return [];
  }
  const source = site.sourceExpr.name;

  const candidates = new Set<string>();
  walkVisual(site.jsx, null, (node, parent) => {
    if (
      t.isIdentifier(node) &&
      instanceState.has(node.name) &&
      node.name !== source &&
      comparisonFor(node, parent, site.keyExpr!)
    ) {
      candidates.add(node.name);
    }
  });
  if (candidates.size === 0) return [];

  const invalid = new Set<string>();
  walkVisual(site.jsx, null, (node, parent) => {
    if (
      t.isIdentifier(node) &&
      candidates.has(node.name) &&
      t.isReferenced(node, parent as t.Node) &&
      !comparisonFor(node, parent, site.keyExpr!)
    ) {
      invalid.add(node.name);
    }
  });
  return [...candidates].filter((name) => !invalid.has(name)).sort();
}

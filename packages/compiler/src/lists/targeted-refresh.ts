import {
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  isIdentifier,
  isNode,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Identifier,
} from '../ast';
import { astBindingAt, keyPathOf, type Ctx, type MapCallExpression } from '../context';
import type { MapSite } from './map-site';

const EQUALITY_OPERATORS = new Set(['===']);
const NON_SEMANTIC_FIELDS = new Set([
  'loc',
  'range',
  'start',
  'end',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

type TargetedListSite = Pick<MapSite, 'jsx' | 'keyExpr' | 'sourceLocal' | 'sourceExpr' | 'itemParam'>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function equivalentValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof RegExp && right instanceof RegExp) {
    return left.source === right.source && left.flags === right.flags;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftItems: readonly unknown[] = left;
    const rightItems: readonly unknown[] = right;
    return (
      leftItems.length === rightItems.length &&
      leftItems.every((item, index) =>
        equivalentValues(item, rightItems[index]),
      )
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  if (
    (isNode(left) || isNode(right)) &&
    (!isNode(left) || !isNode(right) || left.type !== right.type)
  ) {
    return false;
  }

  const leftFields = left;
  const rightFields = right;
  const keys = new Set([...Object.keys(leftFields), ...Object.keys(rightFields)]);
  for (const key of keys) {
    if (NON_SEMANTIC_FIELDS.has(key)) continue;
    if (!equivalentValues(leftFields[key], rightFields[key])) return false;
  }
  return true;
}

function walkVisual(
  node: BaseNode,
  visit: (
    node: BaseNode,
    parent: BaseNode | null,
    key: string | undefined,
  ) => void,
): void {
  walkAst(node, {
    enter(current, parent, key) {
      visit(current, parent, key);
      return FUNCTION_NODES.has(current.type) ? false : undefined;
    },
  });
}

function comparisonFor(
  identifier: Identifier,
  parent: BaseNode | null,
  key: BaseNode,
): boolean {
  if (parent?.type !== 'BinaryExpression') return false;
  const parentFields = fields(parent);
  const operator = parentFields.operator;
  if (typeof operator !== 'string' || !EQUALITY_OPERATORS.has(operator)) {
    return false;
  }
  const left = parentFields.left;
  const right = parentFields.right;
  const other = left === identifier ? right : left;
  return isNode(other) && equivalentValues(other, key);
}

function isReferencedIdentifier(
  parent: BaseNode | null,
  key: string | undefined,
): boolean {
  if (parent === null) return false;
  const parentFields = fields(parent);
  if (
    (parent.type === 'MemberExpression' &&
      key === 'property' &&
      parentFields.computed === false) ||
    ((parent.type === 'Property' || parent.type === 'ObjectProperty') &&
      key === 'key' &&
      parentFields.computed === false) ||
    ((parent.type === 'MethodDefinition' || parent.type.endsWith('Method')) &&
      key === 'key' &&
      parentFields.computed === false) ||
    (parent.type === 'VariableDeclarator' && key === 'id') ||
    ((parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression') &&
      (key === 'id' || key === 'params')) ||
    parent.type.startsWith('Import') ||
    (parent.type === 'ExportSpecifier' && key === 'exported') ||
    (parent.type === 'LabeledStatement' && key === 'label') ||
    ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') &&
      key === 'label')
  ) {
    return false;
  }
  return true;
}

/**
 * Finds instance-state values that affect exactly the row keyed by that value.
 * Every visual reference must be an equality comparison with the authored key;
 * mixed/general uses are rejected and retain full-list reconciliation.
 */
export function findTargetedListDependencies(
  site: TargetedListSite,
  instanceState: ReadonlySet<string>,
  moduleState: ReadonlySet<string>,
): string[] {
  if (
    site.jsx === null ||
    site.keyExpr === null ||
    !isIdentifier(site.sourceExpr) ||
    !(site.sourceLocal ? instanceState : moduleState).has(site.sourceExpr.name) ||
    keyPathOf(site.keyExpr, site.itemParam) === null
  ) {
    return [];
  }
  const source = site.sourceExpr.name;

  const candidates = new Set<string>();
  walkVisual(site.jsx, (node, parent) => {
    if (
      isIdentifier(node) &&
      instanceState.has(node.name) &&
      node.name !== source &&
      comparisonFor(node, parent, site.keyExpr!)
    ) {
      candidates.add(node.name);
    }
  });
  if (candidates.size === 0) return [];

  const invalid = new Set<string>();
  walkVisual(site.jsx, (node, parent, key) => {
    if (
      isIdentifier(node) &&
      candidates.has(node.name) &&
      isReferencedIdentifier(parent, key) &&
      !comparisonFor(node, parent, site.keyExpr!)
    ) {
      invalid.add(node.name);
    }
  });
  return [...candidates].filter((name) => !invalid.has(name)).sort();
}

/** A getter/helper/derivation can read selection without naming it in row JSX.
 * Reject such captures rather than assuming all visible equality uses are the
 * complete dependency set. Authored event reads and direct writes do not make
 * other rows visually dependent on the value.
 */
export function hasHiddenListDependency(
  ctx: Ctx,
  component: string,
  call: MapCallExpression,
  site: TargetedListSite,
  value: string,
): boolean {
  const owner = ctx.compPaths.get(component)?.node;
  if (owner === undefined || ctx.astAnalysis == null) return true;
  const binding = astBindingAt(ctx, owner as BaseNode, value);
  if (binding === undefined) return true;
  for (const reference of binding.references) {
    const parent = ctx.astAnalysis.parentByNode.get(reference) ?? null;
    const parentFields = parent === null ? null : fields(parent);
    if (parent?.type === 'AssignmentExpression' && parentFields?.left === reference &&
        parentFields.operator === '=') continue;
    let current: BaseNode | null = reference;
    let event = false;
    let visual = false;
    let captured = false;
    while (current !== null && current !== owner) {
      if (current === site.jsx) visual = true;
      if (FUNCTION_NODES.has(current.type) && current !== call.arguments[0]) captured = true;
      if (current.type === 'JSXAttribute') {
        const name = fields(current).name;
        if (isNode(name) && name.type === 'JSXIdentifier' &&
            typeof fields(name).name === 'string' && /^on[A-Z]/.test(fields(name).name as string)) event = true;
      }
      current = ctx.astAnalysis.parentByNode.get(current) ?? null;
    }
    if (!event && (!visual || captured)) return true;
  }
  return false;
}

/** Module selection proofs and static list-reader ownership. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { FUNCTION_NODE_TYPES, isReferenceIdentifier, nodeFields, walkAst, type BaseNode } from '../ast';
import { astBindingAt, attrExpr, keyPathOf } from '../context';
import { type Ctx } from '../context';
import { localBindingForProp, objectBindingName } from '../components/props';
import { findKeyComparisons } from './targeted-refresh';
import type { MapSite } from './map-site';

function isExported(ctx: Ctx, node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current !== null) {
    if (current.type === 'ExportNamedDeclaration' || current.type === 'ExportDefaultDeclaration') return true;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

/** Getters, helpers and initializers can hide a read from the visible row. */
function hasHiddenModuleRead(ctx: Ctx, value: string): boolean {
  const analysis = ctx.astAnalysis;
  const binding = analysis?.rootScope.getBinding(value);
  if (!analysis || !binding || binding.kind === 'import' || isExported(ctx, binding.identifier)) return true;
  const components = new Set([...ctx.compPaths.values()].map(path => path.node as BaseNode));
  for (const reference of binding.references) {
    const parent = analysis.parentByNode.get(reference);
    if (parent?.type === 'AssignmentExpression' && nodeFields(parent).left === reference &&
        nodeFields(parent).operator === '=') continue;
    let current: BaseNode | null = reference;
    let event = false;
    let visual = false;
    let hiddenFunction = false;
    while (current !== null) {
      if (current.type === 'JSXElement' || current.type === 'JSXFragment') visual = true;
      if (current.type === 'JSXAttribute') {
        const attribute = current as t.JSXAttribute;
        if (astFactory.isJSXIdentifier(attribute.name) && /^on[A-Z]/.test(attribute.name.name)) event = true;
      }
      if (FUNCTION_NODE_TYPES.has(current.type) && !components.has(current)) {
        const consumer = analysis.parentByNode.get(current);
        // Only the compiler's JSX map callback is another render scope.
        if (consumer?.type !== 'CallExpression' ||
            !ctx.analyzedListSources.has(consumer as t.CallExpression) ||
            (consumer as t.CallExpression).arguments[0] !== current) hiddenFunction = true;
      }
      current = analysis.parentByNode.get(current) ?? null;
    }
    if (!event && (!visual || hiddenFunction)) return true;
  }
  return false;
}

function componentKey(ctx: Ctx, site: MapSite): { jsx: t.JSXElement; key: t.Expression } | null {
  if (site.rowComp === null || site.jsx === null) return null;
  const component = ctx.compPaths.get(site.rowComp)?.node;
  const props = ctx.componentProps.get(site.rowComp);
  const path = keyPathOf(site.keyExpr, site.itemParam);
  if (!component || isExported(ctx, component) || !props || path === null || site.jsx.openingElement.attributes.some(attribute =>
    astFactory.isJSXSpreadAttribute(attribute))) return null;
  const returns = component.body.body.filter(statement => astFactory.isReturnStatement(statement));
  if (returns.length !== 1 || !astFactory.isReturnStatement(returns[0]) ||
      !astFactory.isJSXElement(returns[0].argument)) return null;
  for (const attribute of site.jsx.openingElement.attributes) {
    if (!astFactory.isJSXAttribute(attribute) || !astFactory.isJSXIdentifier(attribute.name) ||
        attribute.name.name === 'key') continue;
    const value = attrExpr(attribute.value);
    if (!astFactory.isIdentifier(value, { name: site.itemParam })) continue;
    const envelope = objectBindingName(props);
    const local = localBindingForProp(props, attribute.name.name);
    const root = envelope ?? local;
    if (root === null) continue;
    const expected = envelope === null ? path : [attribute.name.name, ...path];
    let key: t.Expression | null = null;
    walkAst(returns[0].argument, { enter(node) {
      if (FUNCTION_NODE_TYPES.has(node.type)) return false;
      if (!astFactory.isMemberExpression(node)) return;
      const actual = keyPathOf(node, root);
      if (actual !== null && actual.length === expected.length && actual.every((segment, index) => segment === expected[index])) key = node;
      return;
    } });
    if (key !== null) return { jsx: returns[0].argument, key };
  }
  return null;
}

export function findModuleListSelections(ctx: Ctx, owner: string, site: MapSite): string[] {
  if (site.prelude.length > 0 || site.jsx === null || site.keyExpr === null ||
      !astFactory.isIdentifier(site.sourceExpr) || keyPathOf(site.keyExpr, site.itemParam) === null) return [];
  const source = site.sourceExpr.name;
  if (site.sourceLocal
    ? ctx.instanceState.get(owner)?.has(source) !== true
    : !ctx.state.has(source) || ctx.state.get(source) === 'computed') return [];
  const state = new Set([...ctx.state].filter(([name, kind]) => kind === 'let' &&
    ctx.astAnalysis?.rootScope.getBinding(name)?.kind !== 'import').map(([name]) => name));
  const moduleReference = (node: BaseNode & { name: string }): boolean =>
    astBindingAt(ctx, node, node.name)?.scope.isProgramScope === true;
  const ownerValues = findKeyComparisons(site.jsx, site.keyExpr, state, site.sourceExpr.name, moduleReference);
  const row = site.form === 'component' ? componentKey(ctx, site) : null;
  const rowValues = row === null ? [] : findKeyComparisons(row.jsx, row.key, state, '', moduleReference);
  const values = new Set([...ownerValues, ...rowValues]);
  // A prop comparison cannot mask a general module read in the row component.
  if (site.form === 'component') {
    if (row === null) return [];
    for (const value of values) {
      let readsInRow = false;
      walkAst(row.jsx, { enter(node, parent, key) {
        if (FUNCTION_NODE_TYPES.has(node.type)) return false;
        if (astFactory.isIdentifier(node, { name: value }) && isReferenceIdentifier(parent, key) &&
            astBindingAt(ctx, node, value)?.scope.isProgramScope === true) readsInRow = true;
        return;
      } });
      if (readsInRow && !rowValues.includes(value)) values.delete(value);
    }
  }
  return [...values].filter(value => !hasHiddenModuleRead(ctx, value)).sort();
}

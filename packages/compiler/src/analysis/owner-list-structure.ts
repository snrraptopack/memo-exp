/** Closed owner arrays whose every visible write preserves retained contents. */
import type * as t from '../ast/compiler-types';
import {
  childNode, childNodes, identifierName, nodeField, stringValue, walkAst,
  type BaseNode, type Binding,
} from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx, type MapCallExpression } from '../context';
import { matchMapCall } from '../lists/source-shapes';
import { isPlainScalarValue } from './plain-scalar';

function property(node: BaseNode): string | null {
  const key = childNode(node, 'property');
  return nodeField(node, 'computed') === true ? stringValue(key) : identifierName(key);
}

/** Dense literals only: spreads may invoke an overridden iterator. */
function elements(node: BaseNode | null): BaseNode[] | null {
  if (node?.type !== 'ArrayExpression') return null;
  const values = nodeField(node, 'elements');
  return Array.isArray(values) && values.every(value => value !== null && value.type !== 'SpreadElement')
    ? values as BaseNode[] : null;
}

function recordFields(node: BaseNode): Set<string> | null {
  if (node.type !== 'ObjectExpression') return null;
  const fields = new Set<string>();
  for (const entry of childNodes(node, 'properties')) {
    const name = identifierName(childNode(entry, 'key')) ?? stringValue(childNode(entry, 'key'));
    if (entry.type !== 'Property' || nodeField(entry, 'kind') !== 'init' ||
        nodeField(entry, 'computed') === true || name === null || name === '__proto__' ||
        fields.has(name) || !isPlainScalarValue(childNode(entry, 'value'), () => false)) return null;
    fields.add(name);
  }
  return fields;
}

export function analyzeOwnerListStructure(ctx: Ctx): void {
  const analysis = ctx.astAnalysis;
  if (analysis == null || ctx.hot) return;
  let dynamicScope = false;
  walkAst(analysis.rootScope.block, { enter(node) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
  }});
  if (dynamicScope) return;
  const parents = analysis.parentByNode;
  const sameBinding = (node: BaseNode | null, binding: Binding): boolean => {
    const name = identifierName(node);
    return node !== null && name !== null && astBindingAt(ctx, node, name) === binding;
  };
  const readOnly = (node: BaseNode): boolean => {
    let current = node;
    for (let parent = parents.get(current); parent != null; parent = parents.get(current)) {
      if (parent.type === 'AssignmentExpression' || parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') {
        return childNode(parent, 'left') !== current;
      }
      if (parent.type === 'UpdateExpression' || parent.type === 'UnaryExpression' && nodeField(parent, 'operator') === 'delete') return false;
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(parent.type)) break;
      current = parent;
    }
    return true;
  };
  for (const [owner, path] of ctx.compPaths) {
    const candidates = new Map<Binding, string>();
    walkAst(path.node, { enter(node) {
      const call = matchMapCall(node as t.Node);
      if (call === null || ctx.analyzedListSources.get(call)?.local !== true) return;
      const source = childNode(childNode(call, 'callee')!, 'object');
      const name = identifierName(source);
      const binding = source === null || name === null ? undefined : astBindingAt(ctx, source, name);
      if (binding !== undefined && ctx.instanceState.get(owner)?.has(name!) &&
          astBindingAt(ctx, path.node.body, name!) === binding) candidates.set(binding, name!);
    }});
    for (const [binding, source] of candidates) {
      const declaration = variableDeclaratorFor(ctx, binding);
      const initial = elements(declaration && childNode(declaration, 'init'));
      if (initial === null || initial.some(value => recordFields(value) === null)) continue;
      const arrays: BaseNode[][] = [initial];
      let valid = true;
      for (const violation of binding.constantViolations) {
        const values = elements(childNode(violation, 'right'));
        if (violation.type !== 'AssignmentExpression' || nodeField(violation, 'operator') !== '=' ||
            !sameBinding(childNode(violation, 'left'), binding) || values === null) { valid = false; break; }
        arrays.push(values);
      }
      if (!valid) continue;
      let minimumLength = Math.min(...arrays.map(array => array.length));
      for (const reference of binding.references) {
        const use = parents.get(reference);
        const consumer = use && parents.get(use);
        if (use?.type === 'MemberExpression' && property(use) === 'length' &&
            consumer?.type === 'AssignmentExpression' && childNode(consumer, 'left') === use) {
          const right = childNode(consumer, 'right');
          const value = right && nodeField(right, 'value');
          if (nodeField(consumer, 'operator') !== '=' || right?.type !== 'Literal' ||
              typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { valid = false; break; }
          minimumLength = Math.min(minimumLength, value);
        }
      }
      if (!valid) continue;
      const indexedItem = (node: BaseNode | null): boolean => {
        if (node === null) return false;
        const index = childNode(node, 'property');
        const value = index && nodeField(index, 'value');
        return node.type === 'MemberExpression' && nodeField(node, 'computed') === true &&
          nodeField(node, 'optional') !== true && sameBinding(childNode(node, 'object'), binding) &&
          index?.type === 'Literal' && typeof value === 'number' && Number.isSafeInteger(value) &&
          value >= 0 && value < minimumLength;
      };
      let fields: Set<string> | null = null;
      const record = (node: BaseNode): boolean => {
        const own = recordFields(node);
        if (own === null) return false;
        if (fields === null) fields = own;
        else for (const name of fields) if (!own.has(name)) fields.delete(name);
        return true;
      };
      for (const array of arrays) for (const value of array) {
        if (!indexedItem(value) && !record(value)) valid = false;
      }
      // Include every indexed replacement before inspecting any row reads.
      for (const reference of binding.references) {
        const use = parents.get(reference);
        const consumer = use && parents.get(use);
        if (use != null && indexedItem(use) && consumer?.type === 'AssignmentExpression' &&
            childNode(consumer, 'left') === use) {
          const right = childNode(consumer, 'right');
          if (nodeField(consumer, 'operator') !== '=' || right === null ||
              !indexedItem(right) && !record(right)) valid = false;
        }
      }
      const knownFields = fields as ReadonlySet<string> | null;
      if (!valid || knownFields === null || knownFields.size === 0) continue;
      const arrayElements = new Set(arrays.flat());
      const calls: MapCallExpression[] = [];
      const pureRow = (call: BaseNode): boolean => {
        if (nodeField(call, 'optional') === true || childNodes(call, 'arguments').length !== 1) return false;
        const callback = childNodes(call, 'arguments')[0]!;
        const params = childNodes(callback, 'params');
        const body = childNode(callback, 'body');
        if (callback.type !== 'ArrowFunctionExpression' || nodeField(callback, 'async') === true ||
            params.length < 1 || params.length > 2 || params.some(param => param.type !== 'Identifier') ||
            body?.type !== 'JSXElement') return false;
        const item = astBindingAt(ctx, params[0]!, identifierName(params[0])!);
        const index = params[1] && astBindingAt(ctx, params[1], identifierName(params[1])!);
        if (item === undefined || item.constantViolations.length !== 0 || index?.constantViolations.length) return false;
        const itemField = (node: BaseNode): boolean => node.type === 'MemberExpression' &&
          sameBinding(childNode(node, 'object'), item) && knownFields.has(property(node) ?? '');
        for (const reference of item.references) {
          const use = parents.get(reference);
          if (use == null || !itemField(use) || !readOnly(use)) return false;
        }
        let pure = true;
        walkAst(body, { enter(node) {
          if (!pure) return false;
          if (node.type === 'JSXAttribute') {
            const name = identifierName(childNode(node, 'name')) ?? nodeField(childNode(node, 'name')!, 'name');
            if (name === 'ref') { pure = false; return false; }
            if (typeof name === 'string' && /^on[A-Z]/.test(name)) return false;
          }
          if (node.type === 'JSXElement') {
            const tag = childNode(childNode(node, 'openingElement')!, 'name');
            const name = tag && nodeField(tag, 'name');
            if (tag?.type !== 'JSXIdentifier' || typeof name !== 'string' || !/^[a-z]/.test(name)) pure = false;
          }
          if (node.type === 'JSXSpreadAttribute' || node.type === 'JSXSpreadChild' || node.type === 'JSXFragment') pure = false;
          if (node.type === 'JSXExpressionContainer') {
            pure &&= isPlainScalarValue(childNode(node, 'expression'), identifier =>
              index !== undefined && sameBinding(identifier, index), itemField);
            return false;
          }
        }});
        return pure;
      };
      for (const reference of binding.references) {
        const use = parents.get(reference);
        if (use?.type === 'AssignmentExpression' && childNode(use, 'left') === reference) continue;
        if (use?.type !== 'MemberExpression' || childNode(use, 'object') !== reference || nodeField(use, 'optional') === true) { valid = false; break; }
        const consumer = parents.get(use);
        if (property(use) === 'length') {
          if (!readOnly(use) && (consumer?.type !== 'AssignmentExpression' ||
              nodeField(consumer, 'operator') !== '=' || nodeField(childNode(consumer, 'right')!, 'value') !== minimumLength)) valid = false;
        } else if (indexedItem(use)) {
          if (consumer?.type === 'ArrayExpression' && arrayElements.has(use)) continue;
          if (consumer?.type === 'AssignmentExpression' &&
              (childNode(consumer, 'left') === use || indexedItem(childNode(consumer, 'left')!) && childNode(consumer, 'right') === use)) continue;
          if (consumer?.type !== 'MemberExpression' || !knownFields.has(property(consumer) ?? '') || !readOnly(consumer)) valid = false;
        } else if (property(use) === 'map' && consumer != null &&
            childNode(consumer, 'callee') === use && ctx.analyzedListSources.has(consumer as MapCallExpression) && pureRow(consumer)) {
          calls.push(consumer as MapCallExpression);
        } else valid = false;
        if (!valid) break;
      }
      if (!valid || calls.length === 0) continue;
      for (const call of calls) ctx.ownerListStructureSources.set(call, source);
      const sources = new Set([...(ctx.instanceReasonIds.get(owner)?.keys() ?? []), source]);
      ctx.instanceReasonIds.set(owner, new Map([...sources].sort().map((name, index) => [name, index])));
    }
  }
}

import { childNode, childNodes, identifierName, jsxIdentifierName, nodeField, stringValue, walkAst, type BaseNode, type Binding } from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';
import type { MapCallExpression } from '../lists';
import { LIST_METHOD_OPTIMIZATIONS } from '../lists/mutation-shapes';
import { boundedListIndex } from './bounded-list-index';
import { plainListInitializer, plainScalarValue } from './plain-list-initializer';

/** Closed flat records without escapes or cross-row collection reads. */
export function analyzeModuleListTargets(ctx: Ctx): void {
  const analysis = ctx.astAnalysis;
  if (analysis === null || analysis === undefined || ctx.moduleStateCells) return;
  // String-driven lexical access can escape records or install accessors
  // without producing an indexed reference to the collection binding.
  let dynamicScope = false;
  walkAst(analysis.rootScope.block, { enter(node) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
  } });
  if (dynamicScope) return;
  const parents = analysis.parentByNode;
  const property = (node: BaseNode): string | null => {
    const key = childNode(node, 'property');
    if (nodeField(node, 'computed') !== true) return identifierName(key);
    const value = key && nodeField(key, 'value');
    return typeof value === 'string' ? value : null;
  };

  const candidates = new Map<Binding, string>();
  for (const source of ctx.listSources) {
    const binding = analysis.rootScope.getBinding(source);
    if (binding?.scope.isProgramScope) candidates.set(binding, source);
  }
  for (const [component, sources] of ctx.keyedListMutationSources) {
    const owner = ctx.compPaths.get(component)?.node;
    if (owner === undefined) continue;
    for (const source of sources.keys()) {
      const binding = astBindingAt(ctx, owner.body, source);
      if (binding !== undefined) candidates.set(binding, source);
    }
  }
  for (const [binding, source] of candidates) {
    if (binding.constantViolations.length !== 0) continue;
    const declaration = variableDeclaratorFor(ctx, binding);
    const initializer = plainListInitializer(ctx, declaration && childNode(declaration, 'init'));
    if (initializer === null) continue;
    const { array } = initializer;
    const statement = parents.get(declaration!);
    if (statement && parents.get(statement)?.type === 'ExportNamedDeclaration') continue;
    const elements = nodeField(array, 'elements');
    if (!Array.isArray(elements) || elements.length === 0) continue;
    const fields = new Set<string>();
    let valid = true;
    for (const element of elements) {
      const record = initializer.record(element ?? null);
      if (record === null) { valid = false; break; }
      const own = new Set<string>();
      for (const entry of childNodes(record.object, 'properties')) {
        const key = childNode(entry, 'key');
        const name = identifierName(key) ?? stringValue(key);
        if (entry.type !== 'Property' || nodeField(entry, 'computed') === true ||
            nodeField(entry, 'kind') !== 'init' || name === null || name === '__proto__' ||
            own.has(name) || !record.scalar(childNode(entry, 'value'))) { valid = false; break; }
        own.add(name);
      }
      if (!valid) break;
      if (element === elements[0]) for (const name of own) fields.add(name);
      else for (const name of fields) if (!own.has(name)) fields.delete(name);
    }
    if (!valid || fields.size === 0) continue;
    const written = new Set<string>();
    const keys = new Set<string>();
    const visited = new Set<Binding>();

    const sameItemRead = (read: BaseNode, target: BaseNode | null): boolean => {
      if (read.type !== 'MemberExpression' || target?.type !== 'MemberExpression' ||
          nodeField(read, 'optional') === true || nodeField(target, 'optional') === true ||
          !fields.has(property(read) ?? '')) return false;
      const access = childNode(read, 'object'), destination = childNode(target, 'object');
      if (access?.type !== 'MemberExpression' || destination?.type !== 'MemberExpression' ||
          nodeField(access, 'computed') !== true || nodeField(destination, 'computed') !== true ||
          nodeField(access, 'optional') === true || nodeField(destination, 'optional') === true) return false;
      for (const indexed of [access, destination]) {
        const object = childNode(indexed, 'object');
        const name = identifierName(object);
        if (object === null || name === null || astBindingAt(ctx, object, name) !== binding) return false;
      }
      const index = childNode(access, 'property'), targetIndex = childNode(destination, 'property');
      if (index?.type === 'Literal' && targetIndex?.type === 'Literal') {
        return typeof nodeField(index, 'value') === 'number' && nodeField(index, 'value') === nodeField(targetIndex, 'value');
      }
      const name = identifierName(index), targetName = identifierName(targetIndex);
      if (index === null || targetIndex === null || name === null || targetName === null) return false;
      const counter = astBindingAt(ctx, index, name);
      return counter !== undefined && counter === astBindingAt(ctx, targetIndex, targetName);
    };
    const scalarAssignments = new Map<BaseNode, boolean>();
    const scalarAssignment = (assignment: BaseNode): boolean => {
      const cached = scalarAssignments.get(assignment);
      if (cached !== undefined) return cached;
      const target = childNode(assignment, 'left');
      const proven = plainScalarValue(ctx, childNode(assignment, 'right'), undefined, undefined,
        read => sameItemRead(read, target));
      scalarAssignments.set(assignment, proven);
      return proven;
    };
    const readInAssignment = (member: BaseNode): boolean => {
      let current: BaseNode = member;
      for (;;) {
        const parent = parents.get(current);
        if (parent == null) return false;
        if (parent.type === 'AssignmentExpression') return childNode(parent, 'right') === current &&
          sameItemRead(member, childNode(parent, 'left')) && scalarAssignment(parent);
        if (!['BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'UnaryExpression', 'TemplateLiteral'].includes(parent.type)) return false;
        current = parent;
      }
    };

    const inspectItem = (item: Binding, allowProp: boolean): boolean => {
      if (visited.has(item)) return true;
      visited.add(item);
      if (item.constantViolations.length !== 0) return false;
      for (const reference of item.references) {
        const use = parents.get(reference);
        if (!use) return false;
        if (use.type === 'MemberExpression' && childNode(use, 'object') === reference) {
          const name = property(use);
          if (name === null || !fields.has(name)) return false;
          const consumer = parents.get(use);
          if (!consumer || consumer.type === 'AssignmentExpression' && childNode(consumer, 'left') === use ||
              consumer.type === 'UpdateExpression' || consumer.type === 'UnaryExpression' && nodeField(consumer, 'operator') === 'delete') return false;
          // A member on the left of arithmetic/comparison is a read. Only
          // assignment patterns and loop targets can turn wrappers into writes.
          let target = use;
          let enclosing: BaseNode | null | undefined = consumer;
          while (enclosing && ['Property', 'ObjectProperty', 'ObjectPattern', 'ArrayPattern', 'RestElement', 'AssignmentPattern'].includes(enclosing.type)) {
            target = enclosing;
            enclosing = parents.get(target);
          }
          if (enclosing && ['AssignmentExpression', 'ForOfStatement', 'ForInStatement'].includes(enclosing.type) &&
              childNode(enclosing, 'left') === target) return false;
          if (consumer.type === 'JSXExpressionContainer') {
            const attribute = parents.get(consumer);
            if (attribute?.type === 'JSXAttribute' && nodeField(childNode(attribute, 'name')!, 'name') === 'key') keys.add(name);
          }
          continue;
        }
        if (!allowProp || use.type !== 'JSXExpressionContainer') return false;
        const attribute = parents.get(use);
        const opening = attribute && parents.get(attribute);
        if (attribute?.type !== 'JSXAttribute' || opening?.type !== 'JSXOpeningElement') return false;
        const tag = childNode(opening, 'name');
        const component = tag && nodeField(tag, 'name');
        const prop = childNode(attribute, 'name');
        const propName = prop && nodeField(prop, 'name');
        if (typeof component !== 'string' || typeof propName !== 'string') return false;
        const fn = ctx.compPaths.get(component)?.node;
        if (!fn) return false;
        const params = childNodes(fn, 'params');
        if (params.length !== 1 || params[0]!.type !== 'ObjectPattern' ||
            childNodes(params[0]!, 'properties').some(p => p.type !== 'Property' || nodeField(p, 'computed') === true)) return false;
        const entry = childNodes(params[0]!, 'properties').find(p => identifierName(childNode(p, 'key')) === propName);
        const local = entry && childNode(entry, 'value');
        if (!local || local.type !== 'Identifier') return false;
        const localBinding = analysis.nodeToScope.get(local)?.getBinding(identifierName(local)!);
        if (!localBinding || !inspectItem(localBinding, false)) return false;
      }
      return true;
    };

    for (const reference of binding.references) {
      const access = parents.get(reference);
      if (access?.type !== 'MemberExpression' || childNode(access, 'object') !== reference) { valid = false; break; }
      const method = property(access);
      if (method === 'length' && nodeField(access, 'computed') !== true) {
        const test = parents.get(access);
        const counter = test && childNode(test, 'left');
        const scope = counter && analysis.nodeToScope.get(counter);
        if (test?.type === 'BinaryExpression' && childNode(test, 'right') === access &&
            counter != null && scope != null &&
            boundedListIndex(scope, counter, elements.length, source, binding)) continue;
        valid = false; break;
      }
      if (method !== null && Object.hasOwn(LIST_METHOD_OPTIMIZATIONS, method) &&
          LIST_METHOD_OPTIMIZATIONS[method] === 'render' && nodeField(access, 'computed') !== true) {
        const call = parents.get(access);
        const callback = call && childNodes(call, 'arguments')[0];
        const param = callback && childNodes(callback, 'params')[0];
        // Only compiler-owned JSX maps, not arbitrary array callbacks.
        if (!call || call.type !== 'CallExpression' ||
            !ctx.analyzedListSources.has(call as MapCallExpression) || !param || param.type !== 'Identifier' ||
            childNodes(callback!, 'params').length !== 1 || callback!.type !== 'ArrowFunctionExpression') { valid = false; break; }
        // Arbitrary key computations can depend on mutated fields indirectly.
        // Admit only an explicit immutable scalar field or identity key.
        walkAst(callback!, { enter(node) {
          if (node.type !== 'JSXAttribute' || jsxIdentifierName(childNode(node, 'name')) !== 'key') return;
          const value = childNode(node, 'value');
          const expression = value === null ? null : childNode(value, 'expression');
          if (expression?.type !== 'MemberExpression' ||
              identifierName(childNode(expression, 'object')) !== identifierName(param)) { valid = false; return; }
          const name = property(expression);
          if (name === null || !fields.has(name)) valid = false;
          else keys.add(name);
        } });
        if (!valid) break;
        const itemBinding = analysis.nodeToScope.get(param)?.getBinding(identifierName(param)!);
        if (!itemBinding || !inspectItem(itemBinding, true)) { valid = false; break; }
        continue;
      }
      const indexNode = childNode(access, 'property');
      const index = indexNode && nodeField(indexNode, 'value');
      const member = parents.get(access);
      const indexScope = indexNode && analysis.nodeToScope.get(indexNode);
      const fixedIndex = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < elements.length;
      const loopIndex = indexNode !== null && indexScope !== undefined && indexScope !== null &&
        boundedListIndex(indexScope, indexNode, elements.length, source, binding);
      if (nodeField(access, 'computed') !== true || !(fixedIndex || loopIndex) ||
          member?.type !== 'MemberExpression' || childNode(member, 'object') !== access) { valid = false; break; }
      const name = property(member);
      if (name === null || !fields.has(name)) { valid = false; break; }
      const operation = parents.get(member);
      if (operation?.type === 'AssignmentExpression' && childNode(operation, 'left') === member) {
        // Own primitive fields of the addressed row can feed its new value.
        // Bounds, immutable keys and non-escaping storage remain required.
        if (!scalarAssignment(operation)) { valid = false; break; }
        written.add(name);
      } else if (operation?.type === 'UpdateExpression') {
        written.add(name);
      } else if (readInAssignment(member)) {
        continue;
      } else {
        // Reads outside the compiler-owned map can make another row's helper
        // depend on this field. They do not have a proven per-position boundary.
        valid = false; break;
      }
    }
    if (valid && ![...written].some(name => keys.has(name))) {
      // Only compiler-owned JSX maps and bounded direct accesses survived.
      // Opaque methods can escape records or install setters, even if their
      // arguments are plain literals, and invalidate this proof permanently.
      const proof = { length: elements.length, fields: written };
      ctx.plainListItemTargets.set(binding.identifier, proof);
      if (binding.scope.isProgramScope) ctx.moduleListTargets.set(source, proof);
    }
  }
}

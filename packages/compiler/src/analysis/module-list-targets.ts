import { childNode, childNodes, identifierName, jsxIdentifierName, nodeField, walkAst, type BaseNode, type Binding } from '../ast';
import { variableDeclaratorFor, type Ctx } from '../context';
import type { MapCallExpression } from '../lists';
import { LIST_METHOD_OPTIMIZATIONS } from '../lists/mutation-shapes';

/** Closed flat records only. No extra receiver/key evaluations are emitted. */
export function analyzeModuleListTargets(ctx: Ctx): void {
  const analysis = ctx.astAnalysis;
  if (analysis === null || analysis === undefined || ctx.moduleStateCells) return;
  const parents = analysis.parentByNode;
  const property = (node: BaseNode): string | null => {
    const key = childNode(node, 'property');
    if (nodeField(node, 'computed') !== true) return identifierName(key);
    const value = key && nodeField(key, 'value');
    return typeof value === 'string' ? value : null;
  };
  const scalar = (node: BaseNode | null): boolean =>
    node !== null && node.type === 'Literal' &&
    (nodeField(node, 'value') === null || ['string', 'number', 'boolean'].includes(typeof nodeField(node, 'value')));

  for (const source of ctx.listSources) {
    const binding = analysis.rootScope.getBinding(source);
    if (!binding || !binding.scope.isProgramScope || binding.constantViolations.length !== 0) continue;
    const declaration = variableDeclaratorFor(ctx, binding);
    const array = declaration && childNode(declaration, 'init');
    if (!array || array.type !== 'ArrayExpression') continue;
    const statement = parents.get(declaration!);
    if (statement && parents.get(statement)?.type === 'ExportNamedDeclaration') continue;
    const elements = nodeField(array, 'elements');
    if (!Array.isArray(elements) || elements.length === 0) continue;
    // Include every append payload in the same plain-record proof. Names only
    // select candidates; arbitrary arguments and escaping receivers still fail.
    const records = [...elements];
    const appends = new Set<BaseNode>();
    for (const reference of binding.references) {
      const access = parents.get(reference);
      if (access?.type !== 'MemberExpression' || childNode(access, 'object') !== reference) continue;
      const method = property(access);
      if (method === null || !Object.hasOwn(LIST_METHOD_OPTIMIZATIONS, method) ||
          LIST_METHOD_OPTIMIZATIONS[method] !== 'append') continue;
      const call = parents.get(access);
      if (call?.type !== 'CallExpression' || childNode(call, 'callee') !== access) continue;
      records.push(...childNodes(call, 'arguments'));
      appends.add(access);
    }
    const fields = new Set<string>();
    let valid = true;
    for (const element of records) {
      if (!element || element.type !== 'ObjectExpression') { valid = false; break; }
      const own = new Set<string>();
      for (const entry of childNodes(element, 'properties')) {
        const name = identifierName(childNode(entry, 'key'));
        if (entry.type !== 'Property' || nodeField(entry, 'computed') === true ||
            nodeField(entry, 'kind') !== 'init' || name === null || name === '__proto__' ||
            own.has(name) || !scalar(childNode(entry, 'value'))) { valid = false; break; }
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
          if (!consumer || childNode(consumer, 'left') === use ||
              consumer.type === 'UpdateExpression' || consumer.type === 'UnaryExpression' && nodeField(consumer, 'operator') === 'delete') return false;
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
      if (appends.has(access)) continue;
      const method = property(access);
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
      if (nodeField(access, 'computed') !== true || typeof index !== 'number' ||
          !Number.isInteger(index) || index < 0 || index >= elements.length ||
          member?.type !== 'MemberExpression' || childNode(member, 'object') !== access) { valid = false; break; }
      const name = property(member);
      if (name === null || !fields.has(name)) { valid = false; break; }
      const operation = parents.get(member);
      if (operation?.type === 'AssignmentExpression' && childNode(operation, 'left') === member) {
        // Scalar literals preserve the closed plain-data shape indefinitely.
        if (!scalar(childNode(operation, 'right'))) { valid = false; break; }
        written.add(name);
      } else if (operation?.type === 'UpdateExpression') {
        written.add(name);
      } else if (operation?.type === 'UnaryExpression' && nodeField(operation, 'operator') === 'delete') {
        valid = false; break;
      }
    }
    if (valid && ![...written].some(name => keys.has(name))) {
      // Appends preserve existing positions, so proven content writes stay
      // targeted even when the same array is also appended elsewhere. Calls
      // themselves remain content-safe: a property name cannot prove native
      // Array.prototype semantics in JavaScript.
      ctx.moduleListTargets.set(source, { length: elements.length, fields: written });
    }
  }
}

import type * as t from '../ast/compiler-types';
import {
  childNode,
  childNodes,
  nodeField,
  identifierName,
  stringValue,
  type BaseNode,
} from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';

function assignedObject(
  ctx: Ctx,
  at: BaseNode,
  member: t.MemberExpression,
) {
  const name = identifierName(member.object);
  const key = member.computed
    ? stringValue(member.property)
    : identifierName(member.property);
  if (name === null) return null;
  const binding = astBindingAt(ctx, at, name);
  if (binding === undefined) return null;
  const declaration = variableDeclaratorFor(ctx, binding);
  const init = declaration && childNode(declaration, 'init');
  if (init?.type !== 'ObjectExpression') return null;
  return { binding, init, key };
}

/** Visible setters can write arbitrary state outside their apparent receiver. */
export function hasKnownAccessor(ctx: Ctx, at: BaseNode, member: t.MemberExpression): boolean {
  const object = assignedObject(ctx, at, member);
  if (object === null) return false;
  return childNodes(object.init, 'properties').some(property => {
    const kind = nodeField(property, 'kind');
    if (kind !== 'get' && kind !== 'set') return false;
    const keyNode = childNode(property, 'key');
    const key = identifierName(keyNode) ?? stringValue(keyNode);
    return object.key === null || nodeField(property, 'computed') === true || key === object.key;
  });
}

/** Only a non-escaping object literal's own data property permits extra reads. */
export function isPlainDataAssignment(ctx: Ctx, at: BaseNode, member: t.MemberExpression): boolean {
  const object = assignedObject(ctx, at, member);
  if (object === null) return false;
  const { binding, init, key } = object;
  if (key === null || key === '__proto__' || binding.constantViolations.length !== 0) return false;
  let ownsKey = false;
  for (const property of childNodes(init, 'properties')) {
    if (property.type !== 'Property' || nodeField(property, 'computed') === true ||
        nodeField(property, 'kind') !== 'init') return false;
    const propertyKey = childNode(property, 'key');
    const propertyName = identifierName(propertyKey) ?? stringValue(propertyKey);
    if (propertyName === '__proto__') return false;
    if (propertyName === key) ownsKey = true;
  }
  if (!ownsKey) return false;
  const parents = ctx.astAnalysis!.parentByNode;
  for (const reference of binding.references) {
    const access = parents.get(reference);
    if (access?.type !== 'MemberExpression' || childNode(access, 'object') !== reference) {
      return false; // aliases, exports, calls, spreads, or other escapes
    }
    if (nodeField(access, 'computed') === true && stringValue(childNode(access, 'property')) === null) {
      return false;
    }
    const use = parents.get(access);
    if (use?.type === 'UnaryExpression' && nodeField(use, 'operator') === 'delete') return false;
    if (use?.type === 'CallExpression' && childNode(use, 'callee') === access) return false;
  }
  // Exported object values can escape through modules outside this analysis.
  return parents.get(binding.declarationNode)?.type !== 'ExportNamedDeclaration';
}

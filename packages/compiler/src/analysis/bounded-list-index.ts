import { childNode, childNodes, identifierName, nodeField, type BaseNode, type Binding, type Scope } from '../ast';

/** Canonical increasing loop over a fixed, non-escaping array. */
export function boundedListIndex(
  scope: Scope,
  index: BaseNode,
  length: number,
  source: string,
  sourceBinding: Binding | undefined,
): boolean {
  const name = identifierName(index);
  const binding = name === null ? undefined : scope.getBinding(name);
  if (binding === undefined || binding.kind !== 'let') return false;
  const loop = binding.scope.block;
  if (loop.type !== 'ForStatement') return false;
  const init = childNode(loop, 'init');
  const declarations = init && childNodes(init, 'declarations');
  const declaration = declarations?.[0];
  const initial = declaration && childNode(declaration, 'init');
  const start = initial && nodeField(initial, 'value');
  if (init?.type !== 'VariableDeclaration' || declarations?.length !== 1 ||
      childNode(declaration!, 'id') !== binding.identifier ||
      initial?.type !== 'Literal' || typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) return false;
  const test = childNode(loop, 'test');
  const left = test && childNode(test, 'left');
  const right = test && childNode(test, 'right');
  if (test?.type !== 'BinaryExpression' || nodeField(test, 'operator') !== '<' ||
      identifierName(left) !== name || scope.getBinding(source) !== sourceBinding) return false;
  const limit = right && nodeField(right, 'value');
  const literalLimit = right?.type === 'Literal' && typeof limit === 'number' &&
    Number.isSafeInteger(limit) && limit >= 0 && limit <= length;
  const arrayLimit = right?.type === 'MemberExpression' && nodeField(right, 'computed') !== true &&
    identifierName(childNode(right, 'object')) === source && identifierName(childNode(right, 'property')) === 'length';
  if (!literalLimit && !arrayLimit) return false;
  const update = childNode(loop, 'update');
  if (update === null || binding.constantViolations.length !== 1 || binding.constantViolations[0] !== update) return false;
  if (update.type === 'UpdateExpression') {
    return nodeField(update, 'operator') === '++' && identifierName(childNode(update, 'argument')) === name;
  }
  const step = childNode(update, 'right');
  const stride = step && nodeField(step, 'value');
  return update.type === 'AssignmentExpression' && nodeField(update, 'operator') === '+=' &&
    identifierName(childNode(update, 'left')) === name && step?.type === 'Literal' &&
    typeof stride === 'number' && Number.isSafeInteger(stride) && stride > 0;
}

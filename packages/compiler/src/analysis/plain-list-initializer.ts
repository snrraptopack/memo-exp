import { childNode, childNodes, identifierName, nodeField, type BaseNode, type Binding } from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';

/** Primitive literal expressions cannot install accessors or escape a record. */
export function plainScalarValue(ctx: Ctx, node: BaseNode | null, parameters?: ReadonlySet<Binding>): boolean {
  if (node === null) return false;
  if (node.type === 'Literal') return nodeField(node, 'value') === null ||
    ['string', 'number', 'boolean'].includes(typeof nodeField(node, 'value'));
  if (node.type === 'Identifier') {
    const binding = astBindingAt(ctx, node, identifierName(node)!);
    return binding !== undefined && parameters?.has(binding) === true;
  }
  if (node.type === 'BinaryExpression' && nodeField(node, 'operator') === '+') {
    return plainScalarValue(ctx, childNode(node, 'left'), parameters) &&
      plainScalarValue(ctx, childNode(node, 'right'), parameters);
  }
  if (node.type === 'TemplateLiteral') return childNodes(node, 'expressions').every(expression => plainScalarValue(ctx, expression, parameters));
  return node.type === 'UnaryExpression' && ['+', '-', '!', '~'].includes(String(nodeField(node, 'operator'))) &&
    plainScalarValue(ctx, childNode(node, 'argument'), parameters);
}

/** Fresh literal arrays, including stable local factories with literal inputs. */
export function plainListInitializer(ctx: Ctx, init: BaseNode | null): {
  array: BaseNode;
  scalar: (node: BaseNode | null) => boolean;
} | null {
  const parameters = new Set<Binding>();
  let array = init;
  if (init?.type === 'CallExpression' && nodeField(init, 'optional') !== true) {
    const callee = childNode(init, 'callee');
    const name = identifierName(callee);
    const binding = callee === null || name === null ? undefined : astBindingAt(ctx, callee, name);
    if (binding === undefined || binding.constantViolations.length !== 0) return null;
    const declaration = variableDeclaratorFor(ctx, binding);
    const fn = binding.kind === 'function' ? binding.declarationNode
      : binding.kind === 'const' && declaration !== null ? childNode(declaration, 'init') : null;
    if (!fn || !['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type) ||
        nodeField(fn, 'async') === true || nodeField(fn, 'generator') === true) return null;
    const params = childNodes(fn, 'params');
    const args = childNodes(init, 'arguments');
    if (params.length !== args.length || args.some(argument => !plainScalarValue(ctx, argument))) return null;
    for (const param of params) {
      const paramName = identifierName(param);
      const parameter = paramName === null ? undefined : astBindingAt(ctx, param, paramName);
      if (parameter === undefined || parameter.constantViolations.length !== 0) return null;
      parameters.add(parameter);
    }
    const body = childNode(fn, 'body');
    if (body?.type === 'BlockStatement') {
      const statements = childNodes(body, 'body');
      if (statements.length !== 1 || statements[0]!.type !== 'ReturnStatement') return null;
      array = childNode(statements[0]!, 'argument');
    } else array = body;
  }
  if (array?.type !== 'ArrayExpression') return null;
  return { array, scalar: node => plainScalarValue(ctx, node, parameters) };
}

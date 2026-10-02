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

/** Fresh literal arrays, including closed local factory aliases with literal inputs. */
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
      const last = statements.at(-1);
      if (last?.type !== 'ReturnStatement') return null;
      const arrays = new Map<Binding, BaseNode>();
      // Straight-line const declarations can name primitive values or a fresh
      // array. No calls, writes, member reads, control flow or escaped arrays.
      for (const statement of statements.slice(0, -1)) {
        if (statement.type !== 'VariableDeclaration' || nodeField(statement, 'kind') !== 'const') return null;
        for (const declaration of childNodes(statement, 'declarations')) {
          const id = childNode(declaration, 'id');
          const name = identifierName(id);
          const local = id === null || name === null ? undefined : astBindingAt(ctx, id, name);
          const value = childNode(declaration, 'init');
          if (local === undefined || local.constantViolations.length !== 0) return null;
          if (plainScalarValue(ctx, value, parameters)) parameters.add(local);
          else if (value?.type === 'ArrayExpression') arrays.set(local, value);
          else {
            const aliasName = identifierName(value);
            const alias = value === null || aliasName === null ? undefined : astBindingAt(ctx, value, aliasName);
            const target = alias === undefined ? undefined : arrays.get(alias);
            if (target === undefined) return null;
            arrays.set(local, target);
          }
        }
      }
      const parents = ctx.astAnalysis!.parentByNode;
      for (const binding of arrays.keys()) for (const reference of binding.references) {
        const use = parents.get(reference);
        if (use?.type === 'ReturnStatement' && use === last && childNode(use, 'argument') === reference) continue;
        if (use?.type === 'VariableDeclarator' && childNode(use, 'init') === reference) {
          const alias = childNode(use, 'id');
          const name = identifierName(alias);
          const target = alias === null || name === null ? undefined : astBindingAt(ctx, alias, name);
          if (target !== undefined && arrays.has(target)) continue;
        }
        return null;
      }
      array = childNode(last, 'argument');
      if (array?.type === 'Identifier') {
        const binding = astBindingAt(ctx, array, identifierName(array)!);
        array = binding === undefined ? null : arrays.get(binding) ?? null;
      }
      // Only the returned allocation gets its fields inspected below. Extra
      // allocations could contain calls and remain unproven.
      for (const literal of new Set(arrays.values())) {
        if (literal !== array) return null;
      }
    } else array = body;
  }
  if (array?.type !== 'ArrayExpression') return null;
  return { array, scalar: node => plainScalarValue(ctx, node, parameters) };
}

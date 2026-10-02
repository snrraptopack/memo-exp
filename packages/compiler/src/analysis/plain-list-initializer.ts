import { childNode, childNodes, identifierName, nodeField, type BaseNode, type Binding } from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';
import { isPlainScalarValue } from './plain-scalar';

/** Primitive operands cannot invoke user coercion or escape a record. */
export function plainScalarValue(
  ctx: Ctx,
  node: BaseNode | null,
  parameters?: ReadonlySet<Binding>,
  resolveBinding: (node: BaseNode, name: string) => Binding | undefined = (at, name) => astBindingAt(ctx, at, name),
  primitiveMember?: (node: BaseNode) => boolean,
): boolean {
  return isPlainScalarValue(node, identifier => {
    const binding = resolveBinding(identifier, identifierName(identifier)!);
    return binding !== undefined && parameters?.has(binding) === true;
  }, primitiveMember);
}

interface PlainAllocation {
  node: BaseNode;
  bindings: ReadonlySet<Binding>;
}

/** A closed factory may name its fresh allocation, but cannot observe or escape it. */
function plainAllocation(
  ctx: Ctx,
  init: BaseNode | null,
  type: 'ArrayExpression' | 'ObjectExpression',
  inputs?: ReadonlySet<Binding>,
): PlainAllocation | null {
  const parameters = new Set<Binding>();
  let result = init;
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
    if (params.length !== args.length || args.some(argument => !plainScalarValue(ctx, argument, inputs))) return null;
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
      const allocations = new Map<Binding, BaseNode>();
      // Straight-line const declarations can name primitive values or a fresh
      // allocation. No calls, writes, member reads, control flow or escapes.
      for (const statement of statements.slice(0, -1)) {
        if (statement.type !== 'VariableDeclaration' || nodeField(statement, 'kind') !== 'const') return null;
        for (const declaration of childNodes(statement, 'declarations')) {
          const id = childNode(declaration, 'id');
          const name = identifierName(id);
          const local = id === null || name === null ? undefined : astBindingAt(ctx, id, name);
          const value = childNode(declaration, 'init');
          if (local === undefined || local.constantViolations.length !== 0) return null;
          if (plainScalarValue(ctx, value, parameters)) parameters.add(local);
          else if (value?.type === type) allocations.set(local, value);
          else {
            const aliasName = identifierName(value);
            const alias = value === null || aliasName === null ? undefined : astBindingAt(ctx, value, aliasName);
            const target = alias === undefined ? undefined : allocations.get(alias);
            if (target === undefined) return null;
            allocations.set(local, target);
          }
        }
      }
      const parents = ctx.astAnalysis!.parentByNode;
      for (const binding of allocations.keys()) for (const reference of binding.references) {
        const use = parents.get(reference);
        if (use?.type === 'ReturnStatement' && use === last && childNode(use, 'argument') === reference) continue;
        if (use?.type === 'VariableDeclarator' && childNode(use, 'init') === reference) {
          const alias = childNode(use, 'id');
          const name = identifierName(alias);
          const target = alias === null || name === null ? undefined : astBindingAt(ctx, alias, name);
          if (target !== undefined && allocations.has(target)) continue;
        }
        return null;
      }
      result = childNode(last, 'argument');
      if (result?.type === 'Identifier') {
        const binding = astBindingAt(ctx, result, identifierName(result)!);
        result = binding === undefined ? null : allocations.get(binding) ?? null;
      }
      // Only the returned allocation gets its fields inspected below. Extra
      // allocations could contain calls and remain unproven.
      for (const literal of new Set(allocations.values())) {
        if (literal !== result) return null;
      }
    } else result = body;
    if (result?.type !== type) return null;
    return { node: result, bindings: parameters };
  }
  if (result?.type !== type) return null;
  return { node: result, bindings: inputs ?? parameters };
}

interface PlainRecord {
  object: BaseNode;
  scalar: (node: BaseNode | null) => boolean;
}

/** Fresh arrays can contain literals or closed local record-factory calls. */
export function plainListInitializer(ctx: Ctx, init: BaseNode | null): {
  array: BaseNode;
  record: (node: BaseNode | null) => PlainRecord | null;
} | null {
  const allocation = plainAllocation(ctx, init, 'ArrayExpression');
  if (allocation === null) return null;
  return {
    array: allocation.node,
    record(node) {
      const record = plainAllocation(ctx, node, 'ObjectExpression', allocation.bindings);
      return record === null ? null : {
        object: record.node,
        scalar: value => plainScalarValue(ctx, value, record.bindings),
      };
    },
  };
}

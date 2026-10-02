import {
  childNode, identifierName, isReferenceIdentifier, nodeField, walkAst, FUNCTION_NODE_TYPES, type BaseNode, type Binding,
} from '../ast';
import type * as t from '../ast/compiler-types';
import { astBindingAt, astScopeAt, variableDeclaratorFor, type Ctx } from '../context';
import { plainScalarValue } from '../analysis/plain-list-initializer';

/** Primitive lexical values cannot change behind the compiler's write channel. */
export function createSlotPullProof(ctx: Ctx, component: string): (expression: BaseNode) => boolean {
  const owner = ctx.compPaths.get(component)?.node;
  const opaque = ctx.opaqueBindings.get(component);
  const known = new Map<Binding, boolean>();
  const visiting = new Set<Binding>();
  const shadowed = new Set<string>();
  const unsafeCompletion = new Set<BaseNode>();
  const completionReads = new Map<BaseNode, Set<Binding>>();
  const executionOf = (node: BaseNode): BaseNode | undefined => {
    let execution: BaseNode | undefined = node;
    while (execution !== undefined && !FUNCTION_NODE_TYPES.has(execution.type)) {
      execution = ctx.astAnalysis?.parentByNode.get(execution) ?? undefined;
    }
    return execution;
  };
  // Snapshot authored boundaries before event lowering adds commit calls.
  // Normal-exit instrumentation cannot publish a write followed by a throw.
  const completionNodes = new Set([
    ...FUNCTION_NODE_TYPES, 'BlockStatement', 'ExpressionStatement', 'ReturnStatement',
    'VariableDeclaration', 'VariableDeclarator', 'EmptyStatement', 'IfStatement',
    'Identifier', 'Literal', 'UpdateExpression', 'AssignmentExpression',
    'BinaryExpression', 'UnaryExpression', 'TemplateLiteral', 'TemplateElement',
  ]);
  let dynamicScope = false;
  if (owner !== undefined) walkAst<BaseNode>(owner, { enter(node, parent, key) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
    if (astScopeAt(ctx, node) === undefined) return;
    const localName = identifierName(node);
    if (localName !== null) {
      const ownerBinding = astBindingAt(ctx, owner!.body, localName);
      const binding = astBindingAt(ctx, node, localName);
      if (ownerBinding !== undefined && binding !== undefined && binding !== ownerBinding) shadowed.add(localName);
    }
    const execution = executionOf(node);
    if (execution === undefined || execution === owner) return;
    if (!completionNodes.has(node.type) ||
        node.type === 'BinaryExpression' && nodeField(node, 'operator') !== '+' ||
        node.type === 'UnaryExpression' && !['+', '-', '!', '~'].includes(String(nodeField(node, 'operator'))) ||
        node.type === 'Literal' && nodeField(node, 'value') !== null &&
          !['string', 'number', 'boolean'].includes(typeof nodeField(node, 'value'))) {
      unsafeCompletion.add(execution);
    }
    const name = identifierName(node);
    if (name !== null && isReferenceIdentifier(parent, key)) {
      const binding = astBindingAt(ctx, node, name);
      if (binding === undefined) unsafeCompletion.add(execution);
      else if (binding.identifier !== node) {
        let reads = completionReads.get(execution);
        if (reads === undefined) completionReads.set(execution, reads = new Set());
        reads.add(binding);
      }
    }
  } });

  // Emission clones flat slot expressions. Their identifiers still denote the
  // component scope; indexed authored initializers/writes retain lexical lookup.
  // The scalar grammar below excludes nested functions and local shadow scopes.
  const resolve = (node: BaseNode, name: string): Binding | undefined =>
    astScopeAt(ctx, node) === undefined && owner !== undefined
      ? astBindingAt(ctx, owner.body, name) : astBindingAt(ctx, node, name);

  const scalar = (expression: BaseNode | null): boolean => {
    if (expression === null) return false;
    const bindings = new Set<Binding>();
    let valid = true;
    walkAst(expression, { enter(node) {
      const name = identifierName(node);
      if (name === null) return;
      const binding = resolve(node, name);
      if (binding === undefined || !primitive(binding)) valid = false;
      else bindings.add(binding);
    } });
    return valid && plainScalarValue(ctx, expression, bindings, resolve);
  };

  const primitive = (binding: Binding): boolean => {
    const cached = known.get(binding);
    if (cached !== undefined) return cached;
    const name = identifierName(binding.identifier);
    if (owner === undefined || name === null || opaque?.has(name) === true || shadowed.has(name) ||
        binding.scope.isProgramScope || astBindingAt(ctx, owner.body, name) !== binding ||
        visiting.has(binding)) return false;
    const declaration = variableDeclaratorFor(ctx, binding);
    if (declaration === null || childNode(declaration, 'id') !== binding.identifier) return false;
    visiting.add(binding);
    let valid = scalar(childNode(declaration, 'init'));
    for (const write of binding.constantViolations) {
      if (!valid) break;
      const execution = executionOf(write);
      if (execution !== owner && (execution === undefined || unsafeCompletion.has(execution) ||
          !ctx.analyzedFunctions.has(execution as t.Node) ||
          [...(completionReads.get(execution) ?? [])].some(read => read !== binding && !primitive(read)))) {
        valid = false; break;
      }
      const target = childNode(write, write.type === 'UpdateExpression' ? 'argument' : 'left');
      if (identifierName(target) !== name || target === null || astBindingAt(ctx, target, name) !== binding) {
        valid = false;
      } else if (write.type === 'UpdateExpression') {
        valid = ['++', '--'].includes(String(nodeField(write, 'operator')));
      } else {
        valid = write.type === 'AssignmentExpression' && scalar(childNode(write, 'right'));
      }
    }
    visiting.delete(binding);
    known.set(binding, valid);
    return valid;
  };

  return expression => !dynamicScope && scalar(expression);
}

import {
  childNode, identifierName, isReferenceIdentifier, nodeField, walkAst, FUNCTION_NODE_TYPES, type BaseNode, type Binding,
} from '../ast';
import { astBindingAt, astScopeAt, variableDeclaratorFor, type Ctx } from '../context';
import {
  createPrimitivePullPlan, scalarReadFact, type ComponentPullPlan, type PrimitiveBindingFact, type PrimitiveWriteFact,
} from '../analysis/primitive-pull';

/** Snapshot authored facts before lowering changes initializer/write nodes. */
export function planComponentPull(ctx: Ctx, component: string): ComponentPullPlan {
  const owner = ctx.compPaths.get(component)?.node;
  const opaque = ctx.opaqueBindings.get(component);
  // A control-flow result may stay primitive while an opaque condition
  // changes which value it selects. RHS shape alone cannot prove stability.
  const controlled = new Set((ctx.instanceControlFlow.get(component) ?? [])
    .flatMap(control => control.bindings));
  const shadowed = new Set<string>();
  const seen = new Set<Binding>();
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
      if (binding !== undefined) seen.add(binding);
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
  const scopes = ctx.astAnalysis?.nodeToScope;
  const ownerScope = owner === undefined ? undefined : scopes?.get(owner.body);
  const resolve = (node: BaseNode, name: string): Binding | undefined =>
    (scopes?.get(node) ?? ownerScope)?.getBinding(name);
  const bindings = new Map<Binding, PrimitiveBindingFact>();
  for (const binding of seen) {
    const name = identifierName(binding.identifier);
    if (owner === undefined || name === null || opaque?.has(name) === true || controlled.has(name) || shadowed.has(name) ||
        binding.scope.isProgramScope || astBindingAt(ctx, owner.body, name) !== binding) continue;
    const declaration = variableDeclaratorFor(ctx, binding);
    if (declaration === null || childNode(declaration, 'id') !== binding.identifier) continue;
    const writes: PrimitiveWriteFact[] = [];
    for (const write of binding.constantViolations) {
      const execution = executionOf(write);
      const target = childNode(write, write.type === 'UpdateExpression' ? 'argument' : 'left');
      const exactTarget = target !== null && identifierName(target) === name && astBindingAt(ctx, target, name) === binding;
      const value = !exactTarget ? {supported:false,reads:[]} : write.type === 'UpdateExpression'
        ? {supported:['++', '--'].includes(String(nodeField(write, 'operator'))),reads:[]}
        : write.type === 'AssignmentExpression' ? scalarReadFact(childNode(write, 'right'), resolve)
          : {supported:false,reads:[]};
      writes.push({
        execution: execution === owner ? null : execution ?? null,
        completionSafe: execution === owner || execution !== undefined && !unsafeCompletion.has(execution),
        completionReads: execution === undefined ? [] : [...(completionReads.get(execution) ?? [])],
        value,
      });
    }
    bindings.set(binding, {initializer:scalarReadFact(childNode(declaration, 'init'), resolve),writes});
  }
  return createPrimitivePullPlan(bindings, dynamicScope, resolve);
}

export function planComponentPulls(ctx: Ctx): ReadonlyMap<string, ComponentPullPlan> {
  const plans = new Map<string, ComponentPullPlan>();
  for (const component of ctx.compPaths.keys()) {
    if (ctx.volatileComponents.has(component) && ctx.instanceReasonSources.has(component)) {
      plans.set(component, planComponentPull(ctx, component));
    }
  }
  return plans;
}

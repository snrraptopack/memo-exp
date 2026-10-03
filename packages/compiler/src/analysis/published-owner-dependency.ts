/** Owner values whose writes are published by closed host-event handlers. */
import { childNode, childNodes, identifierName, nodeField, walkAst, type BaseNode, type Binding } from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';

const functionTypes = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

export function publishedOwnerDependency(ctx: Ctx, owner: string, component: BaseNode): (node: BaseNode) => boolean {
  const parents = ctx.astAnalysis!.parentByNode;
  const eventExpressions = new Set<BaseNode>();
  const eventFunctions = new Set<BaseNode>();
  walkAst(component, { enter(node) {
    if (node.type !== 'JSXOpeningElement') return;
    const tag = childNode(node, 'name');
    const name = tag && nodeField(tag, 'name');
    if (tag?.type !== 'JSXIdentifier' || typeof name !== 'string' || !/^[a-z]/.test(name)) return;
    for (const attribute of childNodes(node, 'attributes')) {
      const name = childNode(attribute, 'name');
      const event = name && nodeField(name, 'name');
      const value = childNode(attribute, 'value');
      const expression = value?.type === 'JSXExpressionContainer' ? childNode(value, 'expression') : null;
      if (attribute.type === 'JSXAttribute' && typeof event === 'string' && /^on[A-Z]/.test(event) && expression !== null) {
        eventExpressions.add(expression);
        if (functionTypes.has(expression.type)) eventFunctions.add(expression);
      }
    }
  }});
  const enclosingFunction = (node: BaseNode): BaseNode | undefined => {
    for (let parent = parents.get(node); parent != null; parent = parents.get(parent)) {
      if (functionTypes.has(parent.type)) return parent;
    }
  };
  const published = (fn: BaseNode, visiting = new Set<BaseNode>()): boolean => {
    if (eventFunctions.has(fn)) return true;
    if (visiting.has(fn)) return false;
    const declaration = parents.get(fn);
    const id = fn.type === 'FunctionDeclaration' ? childNode(fn, 'id') :
      declaration?.type === 'VariableDeclarator' ? childNode(declaration, 'id') : null;
    const name = identifierName(id);
    const binding = name === null ? undefined : astBindingAt(ctx, childNode(component, 'body')!, name);
    if (binding === undefined || binding.constantViolations.length !== 0 || binding.references.length === 0 ||
        !(binding.declarationNode === fn || variableDeclaratorFor(ctx, binding) === declaration)) return false;
    const next = new Set(visiting).add(fn);
    return binding.references.every(reference => {
      if (eventExpressions.has(reference)) return true;
      const use = parents.get(reference);
      const caller = enclosingFunction(reference);
      return use?.type === 'CallExpression' && childNode(use, 'callee') === reference &&
        caller !== undefined && published(caller, next);
    });
  };
  const eligible = new Map<Binding, boolean>();
  return node => {
    const name = identifierName(node);
    if (name === null || !ctx.instanceState.get(owner)?.has(name)) return false;
    const binding = astBindingAt(ctx, node, name);
    if (binding === undefined || astBindingAt(ctx, childNode(component, 'body')!, name) !== binding) return false;
    let valid = eligible.get(binding);
    if (valid === undefined) {
      valid = binding.constantViolations.every(write => {
        const left = childNode(write, 'left') ?? childNode(write, 'argument');
        const fn = enclosingFunction(write);
        return (write.type === 'AssignmentExpression' || write.type === 'UpdateExpression') &&
          identifierName(left) === name && fn !== undefined && published(fn);
      });
      eligible.set(binding, valid);
    }
    return valid;
  };
}

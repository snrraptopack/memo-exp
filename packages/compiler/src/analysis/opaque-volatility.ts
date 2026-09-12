import {
  childNode,
  childNodes,
  extractPatternIdentifiers,
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier,
} from '../ast';
import { astBindingAt, astScopeAt, type Ctx } from '../context';

function bindingIsExternalImport(binding: Binding | undefined): boolean {
  return binding?.kind === 'import';
}

function calleeRoot(callee: BaseNode): string | null {
  let current = callee;
  while (
    current.type === 'MemberExpression' ||
    current.type === 'OptionalMemberExpression'
  ) {
    const object = childNode(current, 'object');
    if (object === null) return null;
    current = object;
  }
  return identifierName(current);
}

function variableDeclaratorFor(ctx: Ctx, binding: Binding): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return null;
}

function bindingInitializer(ctx: Ctx, binding: Binding): BaseNode | null {
  const declaration = variableDeclaratorFor(ctx, binding);
  return declaration === null ? null : childNode(declaration, 'init');
}

function bindingFunction(ctx: Ctx, binding: Binding): BaseNode | null {
  if (binding.declarationNode.type === 'FunctionDeclaration') {
    return binding.declarationNode;
  }
  const initializer = bindingInitializer(ctx, binding);
  return initializer !== null && FUNCTION_NODES.has(initializer.type)
    ? initializer
    : null;
}

function referencedOwnedRoots(
  ctx: Ctx,
  root: BaseNode,
  owner: BaseNode,
  owned: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  walkAst<BaseNode>(root, {
    enter(current) {
      const name = identifierName(current);
      if (name === null || !owned.has(name)) return;
      const binding = astBindingAt(ctx, current, name);
      if (
        binding !== undefined &&
        binding.references.includes(current as unknown as Identifier) &&
        binding === astBindingAt(ctx, owner, name)
      ) {
        roots.add(name);
      }
    },
  });
  return roots;
}

function isOpaqueInvocation(
  ctx: Ctx,
  invocation: BaseNode,
  tainted: ReadonlySet<string>,
  owner?: BaseNode,
  visiting: Set<BaseNode> = new Set(),
): boolean {
  const callee = childNode(invocation, 'callee');
  if (callee === null) return false;
  const root = calleeRoot(callee);
  if (root === null) return false;
  if (tainted.has(root)) return true;
  const summary = ctx.importedFunctions.get(root);
  if (summary !== undefined) return summary.unbounded;
  const binding = astBindingAt(ctx, invocation, root);
  if (bindingIsExternalImport(binding)) return true;
  if (owner === undefined || invocation.type !== 'CallExpression') return false;

  const fn = binding === undefined ? null : bindingFunction(ctx, binding);
  if (fn === null || visiting.has(fn)) return false;

  visiting.add(fn);
  try {
    let opaque = false;
    const visitingBindings = new Set<Binding>();
    const inspectReturned = (expression: BaseNode): void => {
      if (opaque) return;
      if (referencedOwnedRoots(ctx, expression, owner, tainted).size > 0) {
        opaque = true;
        return;
      }
      const name = identifierName(expression);
      if (name !== null) {
        const returnedBinding = astBindingAt(ctx, expression, name);
        if (
          returnedBinding !== undefined &&
          !visitingBindings.has(returnedBinding)
        ) {
          const initializer = bindingInitializer(ctx, returnedBinding);
          if (initializer !== null) {
            visitingBindings.add(returnedBinding);
            inspectReturned(initializer);
            visitingBindings.delete(returnedBinding);
          }
        }
        if (opaque) return;
      }
      walkAst<BaseNode>(expression, {
        enter(current) {
          if (opaque) return false;
          if (current !== expression && FUNCTION_NODES.has(current.type)) {
            return false;
          }
          if (
            current.type !== 'CallExpression' &&
            current.type !== 'NewExpression'
          ) {
            return;
          }
          if (isOpaqueInvocation(ctx, current, tainted, owner, visiting)) {
            opaque = true;
            return false;
          }
        },
      });
    };

    const body = childNode(fn, 'body');
    if (body === null) return false;
    if (body.type !== 'BlockStatement') {
      inspectReturned(body);
    } else {
      walkAst<BaseNode>(body, {
        enter(current) {
          if (opaque) return false;
          if (current !== body && FUNCTION_NODES.has(current.type)) return false;
          if (current.type !== 'ReturnStatement') return;
          const argument = childNode(current, 'argument');
          if (argument !== null) inspectReturned(argument);
          return false;
        },
      });
    }
    return opaque;
  } finally {
    visiting.delete(fn);
  }
}

function assignedRoot(target: BaseNode): string | null {
  let current = target;
  while (
    current.type === 'MemberExpression' ||
    current.type === 'OptionalMemberExpression'
  ) {
    const object = childNode(current, 'object');
    if (object === null) return null;
    current = object;
  }
  return identifierName(current);
}

function findAncestor(
  ctx: Ctx,
  start: BaseNode,
  predicate: (candidate: BaseNode) => boolean,
): BaseNode | null {
  let current = ctx.astAnalysis?.parentByNode.get(start) ?? null;
  while (current !== null) {
    if (predicate(current)) return current;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return null;
}

function moduleOpaqueRoots(
  ctx: Ctx,
  opaqueImports: readonly string[],
): Set<string> {
  const programScope = ctx.astAnalysis?.rootScope;
  if (programScope === undefined) return new Set(opaqueImports);
  const owned = new Set(programScope.bindings.keys());
  const tainted = new Set(opaqueImports);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, binding] of programScope.bindings) {
      if (tainted.has(name)) continue;
      const initializer = bindingInitializer(ctx, binding);
      if (initializer === null) continue;
      const reads = referencedOwnedRoots(
        ctx,
        initializer,
        programScope.block,
        owned,
      );
      let opaque = [...reads].some((read) => tainted.has(read));
      if (!opaque) {
        walkAst<BaseNode>(initializer, {
          enter(current) {
            if (
              current.type !== 'CallExpression' &&
              current.type !== 'NewExpression'
            ) {
              return;
            }
            if (
              isOpaqueInvocation(
                ctx,
                current,
                tainted,
                programScope.block,
              )
            ) {
              opaque = true;
              return false;
            }
          },
        });
      }
      if (opaque) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
}

function jsxAttributeName(attribute: BaseNode): string | null {
  const name = childNode(attribute, 'name');
  if (name?.type === 'JSXIdentifier') {
    const value = fields(name).name;
    return typeof value === 'string' ? value : null;
  }
  if (name?.type !== 'JSXNamespacedName') return null;
  const namespace = childNode(name, 'namespace');
  const local = childNode(name, 'name');
  const namespaceName =
    namespace?.type === 'JSXIdentifier' ? fields(namespace).name : null;
  const localName = local?.type === 'JSXIdentifier' ? fields(local).name : null;
  return typeof namespaceName === 'string' && typeof localName === 'string'
    ? `${namespaceName}:${localName}`
    : null;
}

function renderedRoots(
  ctx: Ctx,
  component: BaseNode,
  owned: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  walkAst<BaseNode>(component, {
    enter(current, parent) {
      let expression: BaseNode | null = null;
      if (current.type === 'JSXExpressionContainer') {
        if (parent?.type === 'JSXAttribute') {
          const name = jsxAttributeName(parent);
          if (name === 'ref' || (name !== null && /^on[A-Z]/.test(name))) {
            return false;
          }
        }
        expression = childNode(current, 'expression');
      } else if (current.type === 'JSXSpreadAttribute') {
        expression = childNode(current, 'argument');
      }
      if (expression === null || expression.type === 'JSXEmptyExpression') return;
      for (const root of referencedOwnedRoots(ctx, expression, component, owned)) {
        roots.add(root);
      }
      return false;
    },
  });
  return roots;
}

/**
 * Mark owners whose render output pulls from state that may continue changing
 * after control escaped into compiler-invisible code.
 */
export function scanOpaqueVolatility(ctx: Ctx): void {
  const programBindings = ctx.astAnalysis?.rootScope.bindings;
  if (programBindings === undefined) return;

  const opaqueImports = [...programBindings]
    .filter(([name, binding]) => {
      if (!bindingIsExternalImport(binding)) return false;
      if (ctx.importedState.has(name) || ctx.importedComponents.has(name)) {
        return false;
      }
      const summary = ctx.importedFunctions.get(name);
      return summary === undefined || summary.unbounded;
    })
    .map(([name]) => name);
  const moduleTainted = moduleOpaqueRoots(ctx, opaqueImports);

  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const componentScope = astScopeAt(ctx, componentNode);
    const owned = new Set([
      ...(componentScope?.bindings.keys() ?? []),
      ...ctx.state.keys(),
      ...moduleTainted,
      ...(ctx.instanceState.get(component) ?? []),
      ...(ctx.instanceDerivedBindings.get(component) ?? []),
      ...(ctx.componentProps.get(component)?.bindings ?? []),
    ]);
    if (owned.size === 0) continue;

    const tainted = new Set<string>(moduleTainted);
    let changed = true;
    while (changed) {
      changed = false;
      const taint = (name: string): void => {
        if (!owned.has(name) || tainted.has(name)) return;
        tainted.add(name);
        changed = true;
      };

      walkAst<BaseNode>(componentNode, {
        enter(current) {
          if (
            current.type === 'CallExpression' ||
            current.type === 'NewExpression'
          ) {
            if (
              !isOpaqueInvocation(
                ctx,
                current,
                tainted,
                componentNode,
              )
            ) {
              return;
            }
            for (const argument of childNodes(current, 'arguments')) {
              if (argument.type === 'SpreadElement') continue;
              for (const root of referencedOwnedRoots(
                ctx,
                argument,
                componentNode,
                owned,
              )) {
                taint(root);
              }
            }

            const declaration = findAncestor(
              ctx,
              current,
              (candidate) => candidate.type === 'VariableDeclarator',
            );
            const pattern =
              declaration === null ? null : childNode(declaration, 'id');
            if (pattern !== null) {
              for (const identifier of extractPatternIdentifiers(pattern)) {
                taint(identifier.name);
              }
            }

            const assignment = findAncestor(
              ctx,
              current,
              (candidate) =>
                candidate.type === 'AssignmentExpression' &&
                fields(candidate).operator === '=',
            );
            const target =
              assignment === null ? null : childNode(assignment, 'left');
            if (target !== null) {
              const root = assignedRoot(target);
              if (root !== null) taint(root);
            }
            return;
          }

          if (current.type !== 'VariableDeclarator') return;
          const initializer = childNode(current, 'init');
          const pattern = childNode(current, 'id');
          if (initializer === null || pattern === null) return;
          const reads = referencedOwnedRoots(
            ctx,
            initializer,
            componentNode,
            owned,
          );
          if (![...reads].some((read) => tainted.has(read))) return;
          for (const identifier of extractPatternIdentifiers(pattern)) {
            taint(identifier.name);
          }
        },
      });
    }

    const rendered = renderedRoots(ctx, componentNode, owned);
    ctx.opaqueBindings.set(component, tainted);
    if ([...tainted].some((root) => rendered.has(root))) {
      ctx.volatileComponents.add(component);
    }
  }
}

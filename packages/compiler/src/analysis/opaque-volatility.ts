import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Ctx } from '../context';

function bindingIsExternalImport(binding: Binding | undefined): boolean {
  return (
    binding?.path.isImportSpecifier() === true ||
    binding?.path.isImportDefaultSpecifier() === true ||
    binding?.path.isImportNamespaceSpecifier() === true
  );
}

function calleeRoot(callee: t.Node): string | null {
  if (t.isIdentifier(callee)) return callee.name;
  if (!t.isMemberExpression(callee)) return null;
  let current: t.Expression | t.Super = callee.object;
  while (t.isMemberExpression(current)) current = current.object;
  return t.isIdentifier(current) ? current.name : null;
}

function isOpaqueInvocation(
  ctx: Ctx,
  path: NodePath<t.CallExpression | t.NewExpression>,
  tainted: ReadonlySet<string>,
  ownerPath?: NodePath,
  visiting: Set<t.Function> = new Set(),
): boolean {
  const root = calleeRoot(path.node.callee);
  if (root === null) return false;
  if (tainted.has(root)) return true;
  const summary = ctx.importedFunctions.get(root);
  if (summary !== undefined) return summary.unbounded;
  if (bindingIsExternalImport(path.scope.getBinding(root))) return true;
  if (ownerPath === undefined || !path.isCallExpression()) return false;

  const binding = path.scope.getBinding(root);
  let fn: NodePath<t.Function> | null = null;
  if (binding?.path.isFunctionDeclaration() === true) {
    fn = binding.path;
  } else if (binding?.path.isVariableDeclarator() === true) {
    const init = binding.path.get('init');
    if (
      !Array.isArray(init) &&
      (init.isFunctionExpression() || init.isArrowFunctionExpression())
    ) {
      fn = init as NodePath<t.Function>;
    }
  }
  if (fn === null || visiting.has(fn.node)) return false;

  visiting.add(fn.node);
  let opaque = false;
  const visitingBindings = new Set<Binding>();
  const inspectReturned = (expression: NodePath): void => {
    if (opaque || !expression.isExpression()) return;
    if (referencedOwnedRoots(expression, ownerPath, tainted).size > 0) {
      opaque = true;
      return;
    }
    if (expression.isIdentifier()) {
      const binding = expression.scope.getBinding(expression.node.name);
      if (binding?.path.isVariableDeclarator() === true && !visitingBindings.has(binding)) {
        const init = binding.path.get('init');
        if (!Array.isArray(init) && init.node !== null) {
          visitingBindings.add(binding);
          inspectReturned(init);
          visitingBindings.delete(binding);
        }
      }
      if (opaque) return;
    }
    const inspectCall = (
      call: NodePath<t.CallExpression | t.NewExpression>,
    ): void => {
      if (isOpaqueInvocation(ctx, call, tainted, ownerPath, visiting)) {
        opaque = true;
      }
    };
    if (expression.isCallExpression() || expression.isNewExpression()) {
      inspectCall(expression);
    }
    expression.traverse({
      Function(inner) {
        inner.skip();
      },
      CallExpression: inspectCall,
      NewExpression: inspectCall,
    });
  };

  const body = fn.get('body');
  if (!Array.isArray(body) && body.isExpression()) {
    inspectReturned(body);
  } else if (!Array.isArray(body) && body.isBlockStatement()) {
    body.traverse({
      Function(inner) {
        inner.skip();
      },
      ReturnStatement(returnPath) {
        const argument = returnPath.get('argument');
        if (!Array.isArray(argument) && argument.node !== null) {
          inspectReturned(argument);
        }
      },
    });
  }
  visiting.delete(fn.node);
  return opaque;
}

function assignedRoot(node: t.LVal | t.OptionalMemberExpression): string | null {
  let current: t.Node = node;
  while (t.isMemberExpression(current) || t.isOptionalMemberExpression(current)) {
    current = current.object;
  }
  return t.isIdentifier(current) ? current.name : null;
}

function referencedOwnedRoots(
  path: NodePath,
  ownerPath: NodePath,
  owned: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  const record = (identifier: NodePath<t.Identifier>): void => {
    const name = identifier.node.name;
    if (!owned.has(name)) return;
    const binding = identifier.scope.getBinding(name);
    if (binding !== undefined && binding === ownerPath.scope.getBinding(name)) {
      roots.add(name);
    }
  };
  path.traverse({
    ReferencedIdentifier(identifier) {
      if (identifier.isIdentifier()) record(identifier);
    },
  });
  if (path.isReferencedIdentifier()) record(path as NodePath<t.Identifier>);
  return roots;
}

function moduleOpaqueRoots(
  ctx: Ctx,
  componentPath: NodePath<t.FunctionDeclaration>,
  opaqueImports: readonly string[],
): Set<string> {
  const programPath = componentPath.findParent((path) => path.isProgram());
  if (programPath === null || !programPath.isProgram()) {
    return new Set(opaqueImports);
  }
  const owned = new Set(Object.keys(programPath.scope.bindings));
  const tainted = new Set(opaqueImports);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, binding] of Object.entries(programPath.scope.bindings)) {
      if (tainted.has(name)) continue;
      const declaration = binding.path.isVariableDeclarator()
        ? binding.path
        : binding.path.findParent((path) => path.isVariableDeclarator());
      if (declaration === null || !declaration.isVariableDeclarator() || declaration.node.init === null) {
        continue;
      }
      const init = declaration.get('init') as NodePath;
      const reads = referencedOwnedRoots(init, programPath, owned);
      let opaque = [...reads].some((read) => tainted.has(read));
      if (!opaque) {
        init.traverse({
          CallExpression(call) {
            if (isOpaqueInvocation(ctx, call, tainted, programPath)) opaque = true;
          },
          NewExpression(call) {
            if (isOpaqueInvocation(ctx, call, tainted, programPath)) opaque = true;
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

function renderedRoots(
  componentPath: NodePath<t.FunctionDeclaration>,
  owned: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  componentPath.traverse({
    JSXExpressionContainer(container) {
      const attribute = container.parentPath;
      if (attribute.isJSXAttribute()) {
        const name = attribute.node.name;
        const value = t.isJSXIdentifier(name)
          ? name.name
          : `${name.namespace.name}:${name.name.name}`;
        if (value === 'ref' || /^on[A-Z]/.test(value)) return;
      }
      for (const root of referencedOwnedRoots(
        container.get('expression') as NodePath,
        componentPath,
        owned,
      )) {
        roots.add(root);
      }
    },
    JSXSpreadAttribute(spread) {
      for (const root of referencedOwnedRoots(
        spread.get('argument') as NodePath,
        componentPath,
        owned,
      )) {
        roots.add(root);
      }
    },
  });
  return roots;
}

/**
 * Mark owners whose render output pulls from state that may continue changing
 * after control escaped into compiler-invisible code.
 */
export function scanOpaqueVolatility(ctx: Ctx): void {
  for (const [component, componentPath] of ctx.compPaths) {
    const opaqueImports = Object.entries(
      componentPath.scope.getProgramParent().bindings,
    )
      .filter(([name, binding]) => {
        if (!bindingIsExternalImport(binding)) return false;
        if (ctx.importedState.has(name) || ctx.importedComponents.has(name)) {
          return false;
        }
        const summary = ctx.importedFunctions.get(name);
        return summary === undefined || summary.unbounded;
      })
      .map(([name]) => name);
    const moduleTainted = moduleOpaqueRoots(ctx, componentPath, opaqueImports);
    const owned = new Set([
      ...Object.keys(componentPath.scope.bindings),
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
      const visitOpaqueInvocation = (
        call: NodePath<t.CallExpression | t.NewExpression>,
      ): void => {
        if (!isOpaqueInvocation(ctx, call, tainted, componentPath)) return;

        for (const argumentPath of call.get('arguments')) {
          if (argumentPath.isSpreadElement()) continue;
          for (const root of referencedOwnedRoots(
            argumentPath as NodePath,
            componentPath,
            owned,
          )) {
            taint(root);
          }
        }

        const declaration = call.findParent((parent) =>
          parent.isVariableDeclarator(),
        );
        if (declaration?.isVariableDeclarator() === true) {
          for (const name of Object.keys(t.getBindingIdentifiers(declaration.node.id))) {
            taint(name);
          }
        }

        const assignment = call.findParent((parent) =>
          parent.isAssignmentExpression({ operator: '=' }),
        );
        if (assignment?.isAssignmentExpression({ operator: '=' }) === true) {
          const root = assignedRoot(assignment.node.left);
          if (root !== null) taint(root);
        }
      };
      componentPath.traverse({
        CallExpression(call) {
          visitOpaqueInvocation(call);
        },
        NewExpression(call) {
          visitOpaqueInvocation(call);
        },
        VariableDeclarator(declaration) {
          if (declaration.node.init === null) return;
          const reads = referencedOwnedRoots(
            declaration.get('init') as NodePath,
            componentPath,
            owned,
          );
          if (![...reads].some((read) => tainted.has(read))) return;
          for (const name of Object.keys(t.getBindingIdentifiers(declaration.node.id))) {
            taint(name);
          }
        },
      });
    }

    const rendered = renderedRoots(componentPath, owned);
    ctx.opaqueBindings.set(component, tainted);
    if ([...tainted].some((root) => rendered.has(root))) {
      ctx.volatileComponents.add(component);
    }
  }
}

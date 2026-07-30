/**
 * Compile-time JSX-returning functions.
 *
 * Supported functions are expanded at local call sites. Their parameters and
 * pure top-level consts are substituted into cloned JSX/control expressions,
 * leaving ordinary JSX for the existing DOM/list/conditional passes.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx, type Ctx } from '../context';

type RenderFunction =
  | t.FunctionDeclaration
  | t.FunctionExpression
  | t.ArrowFunctionExpression;

interface ResolvedRenderFunction {
  node: RenderFunction;
  bindingPath: NodePath;
}

function directReturn(statement: t.Statement): t.Expression | null {
  if (t.isReturnStatement(statement) && t.isExpression(statement.argument)) {
    return statement.argument;
  }
  if (
    t.isBlockStatement(statement) &&
    statement.body.length === 1
  ) {
    return directReturn(statement.body[0]!);
  }
  return null;
}

function controlExpression(
  statement: t.Statement,
): t.Expression | null {
  const direct = directReturn(statement);
  if (direct !== null) return direct;
  if (t.isIfStatement(statement) && statement.alternate != null) {
    const consequent = controlExpression(statement.consequent);
    const alternate = controlExpression(statement.alternate);
    if (consequent === null || alternate === null) return null;
    return t.conditionalExpression(
      t.cloneNode(statement.test, true),
      t.cloneNode(consequent, true),
      t.cloneNode(alternate, true),
    );
  }
  if (t.isSwitchStatement(statement)) {
    const fallback = statement.cases.find((item) => item.test == null);
    if (fallback === undefined || fallback.consequent.length !== 1) return null;
    let selection = controlExpression(fallback.consequent[0]!);
    if (selection === null) return null;
    for (let index = statement.cases.length - 1; index >= 0; index--) {
      const item = statement.cases[index]!;
      if (item.test == null) continue;
      if (item.consequent.length !== 1) return null;
      const branch = controlExpression(item.consequent[0]!);
      if (branch === null) return null;
      selection = t.conditionalExpression(
        t.binaryExpression(
          '===',
          t.cloneNode(statement.discriminant, true),
          t.cloneNode(item.test, true),
        ),
        t.cloneNode(branch, true),
        selection,
      );
    }
    return selection;
  }
  return null;
}

function functionExpression(
  fn: RenderFunction,
  fail: (message: string) => never,
): {
  expression: t.Expression;
  locals: Map<string, t.Expression>;
} {
  if (t.isExpression(fn.body)) {
    return {
      expression: t.cloneNode(fn.body, true),
      locals: new Map(),
    };
  }

  const locals = new Map<string, t.Expression>();
  const controls: t.Statement[] = [];
  for (const statement of fn.body.body) {
    if (t.isVariableDeclaration(statement, { kind: 'const' })) {
      for (const declaration of statement.declarations) {
        if (
          !t.isIdentifier(declaration.id) ||
          declaration.init == null ||
          !t.isExpression(declaration.init)
        ) {
          fail(
            'memo-dom: JSX render functions require identifier const declarations with expression initializers',
          );
        }
        locals.set(declaration.id.name, t.cloneNode(declaration.init, true));
      }
      continue;
    }
    if (t.isTypeScript(statement) || t.isEmptyStatement(statement)) continue;
    controls.push(statement);
  }

  if (controls.length === 1) {
    const expression = controlExpression(controls[0]!);
    if (expression !== null) return { expression, locals };
  }

  const final = controls.at(-1);
  const fallback = final === undefined ? null : directReturn(final);
  if (fallback !== null) {
    let expression = t.cloneNode(fallback, true);
    for (let index = controls.length - 2; index >= 0; index--) {
      const statement = controls[index]!;
      if (t.isIfStatement(statement) && statement.alternate == null) {
        const branch = controlExpression(statement.consequent);
        if (branch !== null) {
          expression = t.conditionalExpression(
            t.cloneNode(statement.test, true),
            t.cloneNode(branch, true),
            expression,
          );
          continue;
        }
      }
      fail(
        'memo-dom: JSX render functions support pure const setup, JSX return expressions, tail early-return if statements, exhaustive return if/else, or exhaustive return switch statements',
      );
    }
    return { expression, locals };
  }

  return fail(
    'memo-dom: JSX render function does not have supported exhaustive return control flow',
  );
}

function identifierIsKey(
  parent: t.Node,
  key: string,
): boolean {
  return (
    ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
      key === 'property' &&
      !parent.computed) ||
    ((t.isObjectProperty(parent) ||
      t.isObjectMethod(parent) ||
      t.isClassMethod(parent)) &&
      key === 'key' &&
      !parent.computed) ||
    (t.isVariableDeclarator(parent) && key === 'id') ||
    ((t.isFunction(parent) || t.isCatchClause(parent)) &&
      (key === 'params' || key === 'param' || key === 'id')) ||
    (t.isLabeledStatement(parent) && key === 'label')
  );
}

function substituteNode<T extends t.Node>(
  input: T,
  substitutions: ReadonlyMap<string, t.Expression>,
  blocked = new Set<string>(),
): T {
  const root = t.cloneNode(input, true);

  const visit = (
    node: t.Node,
    parent: t.Node | null,
    key: string,
    activeBlocked: ReadonlySet<string>,
  ): t.Node => {
    if (
      t.isIdentifier(node) &&
      !activeBlocked.has(node.name) &&
      substitutions.has(node.name) &&
      (parent === null || !identifierIsKey(parent, key))
    ) {
      return t.cloneNode(substitutions.get(node.name)!, true);
    }

    let nextBlocked = activeBlocked;
    if (t.isFunction(node) && node !== root) {
      const names = node.params.flatMap((param) =>
        Object.keys(t.getBindingIdentifiers(param)),
      );
      nextBlocked = new Set([...activeBlocked, ...names]);
    }

    for (const childKey of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[childKey];
      if (Array.isArray(child)) {
        (node as unknown as Record<string, unknown>)[childKey] = child.map(
          (entry) =>
            entry != null && typeof entry === 'object' && 'type' in entry
              ? visit(entry as t.Node, node, childKey, nextBlocked)
              : entry,
        );
      } else if (
        child != null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        (node as unknown as Record<string, unknown>)[childKey] = visit(
          child as t.Node,
          node,
          childKey,
          nextBlocked,
        );
      }
    }
    if (
      t.isObjectProperty(node) &&
      node.shorthand &&
      !t.isIdentifier(node.value, {
        name: t.isIdentifier(node.key) ? node.key.name : '',
      })
    ) {
      node.shorthand = false;
    }
    return node;
  };

  return visit(root, null, '', blocked) as T;
}

function instantiate(
  resolved: ResolvedRenderFunction,
  call: NodePath<t.CallExpression>,
): t.Expression {
  const fail = (message: string): never => {
    throw call.buildCodeFrameError(message);
  };
  const fn = resolved.node;
  if (fn.async || fn.generator) {
    fail('memo-dom: JSX render functions must be synchronous');
  }
  if (call.node.arguments.some((argument) => t.isSpreadElement(argument))) {
    fail('memo-dom: JSX render function calls do not support spread arguments');
  }
  if (call.node.arguments.length > fn.params.length) {
    fail('memo-dom: JSX render function received more arguments than parameters');
  }

  const substitutions = new Map<string, t.Expression>();
  for (let index = 0; index < fn.params.length; index++) {
    const parameter = fn.params[index]!;
    const argument = call.node.arguments[index];
    const argumentExpression =
      argument !== undefined && t.isExpression(argument)
        ? argument
        : t.identifier('undefined');
    if (t.isIdentifier(parameter)) {
      substitutions.set(parameter.name, t.cloneNode(argumentExpression, true));
      continue;
    }
    if (
      t.isAssignmentPattern(parameter) &&
      t.isIdentifier(parameter.left)
    ) {
      substitutions.set(
        parameter.left.name,
        t.conditionalExpression(
          t.binaryExpression(
            '===',
            t.cloneNode(argumentExpression, true),
            t.identifier('undefined'),
          ),
          t.cloneNode(parameter.right, true),
          t.cloneNode(argumentExpression, true),
        ),
      );
      continue;
    }
    fail(
      'memo-dom: JSX render functions currently require identifier parameters with optional defaults',
    );
  }

  const planned = functionExpression(fn, fail);
  for (const [name, source] of planned.locals) {
    substitutions.set(name, substituteNode(source, substitutions));
  }
  const expression = substituteNode(planned.expression, substitutions);
  if (!nodeHasJsx(expression)) {
    fail('memo-dom: JSX render function expansion did not produce JSX');
  }
  return expression;
}

function resolvedRenderFunction(
  ctx: Ctx,
  call: NodePath<t.CallExpression>,
): ResolvedRenderFunction | null {
  const callee = call.get('callee');
  if (Array.isArray(callee) || !callee.isIdentifier()) return null;
  return resolvedRenderIdentifier(ctx, callee);
}

function resolvedRenderIdentifier(
  ctx: Ctx,
  identifier: NodePath<t.Identifier>,
): ResolvedRenderFunction | null {
  const name = identifier.node.name;
  const topLevel = ctx.jsxHelpers.get(name);
  if (topLevel !== undefined) {
    return {
      node: topLevel.node,
      bindingPath: topLevel,
    };
  }
  const binding = identifier.scope.getBinding(name);
  if (binding?.path.isFunctionDeclaration() && nodeHasJsx(binding.path.node)) {
    return {
      node: binding.path.node,
      bindingPath: binding.path,
    };
  }
  if (binding?.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    if (
      (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) &&
      nodeHasJsx(init.body)
    ) {
      return {
        node: init,
        bindingPath: binding.path,
      };
    }
  }
  return null;
}

function isMapCall(call: t.CallExpression): boolean {
  return (
    t.isMemberExpression(call.callee) &&
    !call.callee.computed &&
    t.isIdentifier(call.callee.property, { name: 'map' })
  );
}

function isRenderReference(reference: NodePath<t.Identifier>): boolean {
  const call = reference.parentPath;
  return (
    call?.isCallExpression() === true &&
    (call.node.callee === reference.node ||
      (isMapCall(call.node) && call.node.arguments[0] === reference.node))
  );
}

function renderCallbackArrow(
  resolved: ResolvedRenderFunction,
  at: NodePath,
): t.ArrowFunctionExpression {
  const fn = resolved.node;
  if (fn.async || fn.generator) {
    throw at.buildCodeFrameError(
      'memo-dom: JSX render callbacks must be synchronous',
    );
  }
  return t.arrowFunctionExpression(
    fn.params.map((parameter) => t.cloneNode(parameter, true)),
    t.cloneNode(fn.body, true),
  );
}

function removeBinding(path: NodePath): void {
  if (path.removed) return;
  if (path.isFunctionDeclaration()) {
    if (path.parentPath?.isExportNamedDeclaration()) path.parentPath.remove();
    else path.remove();
    return;
  }
  if (path.isVariableDeclarator()) {
    const declaration = path.parentPath;
    if (!declaration?.isVariableDeclaration()) return;
    if (declaration.node.declarations.length === 1) {
      if (declaration.parentPath?.isExportNamedDeclaration()) {
        declaration.parentPath.remove();
      } else {
        declaration.remove();
      }
    } else {
      path.remove();
    }
    return;
  }
  if (
    path.isArrowFunctionExpression() ||
    path.isFunctionExpression()
  ) {
    const declaration = path.parentPath;
    if (declaration?.isVariableDeclarator()) removeBinding(declaration);
  }
}

function removeTopLevelHelper(name: string, helper: NodePath): void {
  const programPath = helper.findParent((path) => path.isProgram());
  if (programPath === null || !programPath.isProgram()) {
    removeBinding(helper);
    return;
  }

  for (const statementPath of programPath.get('body')) {
    const declarationPath = statementPath.isExportNamedDeclaration()
      ? statementPath.get('declaration')
      : statementPath;
    if (Array.isArray(declarationPath) || declarationPath == null) continue;

    if (
      declarationPath.isFunctionDeclaration() &&
      declarationPath.node.id?.name === name
    ) {
      statementPath.remove();
      return;
    }
    if (!declarationPath.isVariableDeclaration()) continue;

    const declarators = declarationPath.get('declarations');
    const matching = declarators.find(
      (declarator) =>
        declarator.isVariableDeclarator() &&
        t.isIdentifier(declarator.node.id, { name }),
    );
    if (matching === undefined) continue;
    if (declarators.length === 1) statementPath.remove();
    else matching.remove();
    return;
  }

  removeBinding(helper);
}

function replaceRenderCall(
  call: NodePath<t.CallExpression>,
  expression: t.Expression,
): void {
  const container = call.parentPath;
  const jsxParent = container?.parentPath;
  if (
    (t.isJSXElement(expression) || t.isJSXFragment(expression)) &&
    container?.isJSXExpressionContainer() &&
    (jsxParent?.isJSXElement() || jsxParent?.isJSXFragment()) &&
    jsxParent.node.children.includes(container.node)
  ) {
    container.replaceWith(expression);
    return;
  }
  call.replaceWith(expression);
}

/** Expand every locally resolvable JSX-returning call inside components. */
export function normalizeRenderFunctions(ctx: Ctx): void {
  const usedBindings = new Set<NodePath>();

  for (const [name, helper] of ctx.jsxHelpers) {
    const binding =
      helper.scope.parent?.getBinding(name) ??
      helper.parentPath?.scope.getBinding(name);
    if (
      binding?.referencePaths.some(
        (reference) =>
          reference.isIdentifier() && !isRenderReference(reference),
      )
    ) {
      throw helper.buildCodeFrameError(
        'memo-dom: JSX render functions may only be called in local render composition or passed directly to collection map()',
      );
    }
  }

  for (const [, componentPath] of ctx.compPaths) {
    componentPath.scope.crawl();
    componentPath.traverse({
      CallExpression(path) {
        if (!isMapCall(path.node) || path.node.arguments.length !== 1) return;
        const argument = path.get('arguments')[0];
        if (
          argument === undefined ||
          Array.isArray(argument) ||
          !argument.isIdentifier()
        ) {
          return;
        }
        const resolved = resolvedRenderIdentifier(ctx, argument);
        if (resolved === null) return;
        argument.replaceWith(renderCallbackArrow(resolved, argument));
        usedBindings.add(resolved.bindingPath);
      },
    });

    let changed = true;
    while (changed) {
      changed = false;
      componentPath.scope.crawl();
      const calls: NodePath<t.CallExpression>[] = [];
      componentPath.traverse({
        CallExpression(path) {
          calls.push(path);
        },
      });
      for (const call of calls.reverse()) {
        if (call.removed) continue;
        const resolved = resolvedRenderFunction(ctx, call);
        if (resolved === null) continue;
        replaceRenderCall(call, instantiate(resolved, call));
        usedBindings.add(resolved.bindingPath);
        changed = true;
      }
    }
  }

  for (const [name, helper] of ctx.jsxHelpers) {
    removeTopLevelHelper(name, helper);
  }
  for (const binding of usedBindings) removeBinding(binding);
}

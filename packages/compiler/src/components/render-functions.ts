/** Compile-time JSX-returning function expansion. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  ESTREE_VISITOR_KEYS,
  asNode as node,
  childNode,
  childNodes,
  cloneNode as cloneAstNode,
  extractPatternIdentifiers,
  nodeFields as fields,
  removeNode,
  replaceNode,
  walkAst,
  type BaseNode,
  type Binding,
  type ScopeAnalysis,
} from '../ast';
import {
  astBindingAt,
  nodeHasJsx,
  refreshAstAnalysis,
  type Ctx,
} from '../context';

type RenderFunction =
  | t.FunctionDeclaration
  | t.FunctionExpression
  | t.ArrowFunctionExpression;

type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

interface ResolvedRenderFunction {
  node: RenderFunction;
  bindingNode: BaseNode | null;
}

function identifierName(value: BaseNode | null): string | null {
  if (value?.type !== 'Identifier') return null;
  const name = fields(value).name;
  return typeof name === 'string' ? name : null;
}

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}

function fail(component: ComponentPath, message: string): never {
  throw component.buildCodeFrameError(message);
}

function directReturn(statement: t.Statement): t.Expression | null {
  if (astFactory.isReturnStatement(statement) && statement.argument !== null) {
    return statement.argument as t.Expression;
  }
  if (astFactory.isBlockStatement(statement) && statement.body.length === 1) {
    return directReturn(statement.body[0]!);
  }
  return null;
}

function controlExpression(statement: t.Statement): t.Expression | null {
  const direct = directReturn(statement);
  if (direct !== null) return direct;
  if (astFactory.isIfStatement(statement) && statement.alternate != null) {
    const consequent = controlExpression(statement.consequent);
    const alternate = controlExpression(statement.alternate);
    if (consequent === null || alternate === null) return null;
    return astFactory.conditionalExpression(
      cloneNode(statement.test),
      cloneNode(consequent),
      cloneNode(alternate),
    );
  }
  if (astFactory.isSwitchStatement(statement)) {
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
      selection = astFactory.conditionalExpression(
        astFactory.binaryExpression(
          '===',
          cloneNode(statement.discriminant),
          cloneNode(item.test),
        ),
        cloneNode(branch),
        selection,
      );
    }
    return selection;
  }
  return null;
}

function functionExpression(
  fn: RenderFunction,
  onError: (message: string) => never,
): { expression: t.Expression; locals: Map<string, t.Expression> } {
  const body = fn.body as unknown as BaseNode;
  if (body.type !== 'BlockStatement') {
    return {
      expression: cloneNode(fn.body as t.Expression),
      locals: new Map(),
    };
  }

  const locals = new Map<string, t.Expression>();
  const controls: t.Statement[] = [];
  for (const statement of (fn.body as t.BlockStatement).body) {
    if (astFactory.isVariableDeclaration(statement, { kind: 'const' })) {
      for (const declaration of statement.declarations) {
        if (!astFactory.isIdentifier(declaration.id) || declaration.init == null) {
          onError(
            'memo-dom: JSX render functions require identifier const declarations with expression initializers',
          );
        }
        locals.set(declaration.id.name, cloneNode(declaration.init));
      }
      continue;
    }
    if (astFactory.isTypeScript(statement) || astFactory.isEmptyStatement(statement)) continue;
    controls.push(statement);
  }

  if (controls.length === 1) {
    const expression = controlExpression(controls[0]!);
    if (expression !== null) return { expression, locals };
  }
  const final = controls.at(-1);
  const fallback = final === undefined ? null : directReturn(final);
  if (fallback !== null) {
    let expression = cloneNode(fallback);
    for (let index = controls.length - 2; index >= 0; index--) {
      const statement = controls[index]!;
      if (astFactory.isIfStatement(statement) && statement.alternate == null) {
        const branch = controlExpression(statement.consequent);
        if (branch !== null) {
          expression = astFactory.conditionalExpression(
            cloneNode(statement.test),
            cloneNode(branch),
            expression,
          );
          continue;
        }
      }
      onError(
        'memo-dom: JSX render functions support pure const setup, JSX return expressions, tail early-return if statements, exhaustive return if/else, or exhaustive return switch statements',
      );
    }
    return { expression, locals };
  }
  return onError(
    'memo-dom: JSX render function does not have supported exhaustive return control flow',
  );
}

function identifierIsKey(parent: BaseNode, key: string): boolean {
  return (
    ((parent.type === 'MemberExpression' ||
      parent.type === 'OptionalMemberExpression') &&
      key === 'property' &&
      fields(parent).computed !== true) ||
    ((parent.type === 'ObjectProperty' ||
      parent.type === 'Property' ||
      parent.type === 'ObjectMethod' ||
      parent.type === 'ClassMethod') &&
      key === 'key' &&
      fields(parent).computed !== true) ||
    (parent.type === 'VariableDeclarator' && key === 'id') ||
    ((parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'CatchClause') &&
      (key === 'params' || key === 'param' || key === 'id')) ||
    (parent.type === 'LabeledStatement' && key === 'label')
  );
}

function substituteNode<TNode>(
  input: TNode,
  substitutions: ReadonlyMap<string, t.Expression>,
  blocked = new Set<string>(),
): TNode {
  const root = cloneNode(input) as unknown as BaseNode;
  const visit = (
    current: BaseNode,
    parent: BaseNode | null,
    key: string,
    activeBlocked: ReadonlySet<string>,
  ): BaseNode => {
    const name = identifierName(current);
    if (
      name !== null &&
      !activeBlocked.has(name) &&
      substitutions.has(name) &&
      (parent === null || !identifierIsKey(parent, key))
    ) {
      return cloneNode(substitutions.get(name)!) as unknown as BaseNode;
    }

    let nextBlocked = activeBlocked;
    if (
      current !== root &&
      (current.type === 'FunctionDeclaration' ||
        current.type === 'FunctionExpression' ||
        current.type === 'ArrowFunctionExpression')
    ) {
      const names = childNodes(current, 'params').flatMap((parameter) =>
        extractPatternIdentifiers(parameter).map((identifier) => identifier.name),
      );
      nextBlocked = new Set([...activeBlocked, ...names]);
    }

    for (const childKey of ESTREE_VISITOR_KEYS[current.type] ?? Object.keys(fields(current))) {
      const child = fields(current)[childKey];
      if (Array.isArray(child)) {
        fields(current)[childKey] = child.map((entry) => {
          const item = node(entry);
          return item === null
            ? entry
            : visit(item, current, childKey, nextBlocked);
        });
      } else {
        const item = node(child);
        if (item !== null) {
          fields(current)[childKey] = visit(
            item,
            current,
            childKey,
            nextBlocked,
          );
        }
      }
    }
    if (
      (current.type === 'ObjectProperty' || current.type === 'Property') &&
      fields(current).shorthand === true
    ) {
      const keyName = identifierName(childNode(current, 'key'));
      const valueName = identifierName(childNode(current, 'value'));
      if (keyName !== valueName) fields(current).shorthand = false;
    }
    return current;
  };
  return visit(root, null, '', blocked) as unknown as TNode;
}

function instantiate(
  resolved: ResolvedRenderFunction,
  call: BaseNode,
  component: ComponentPath,
): t.Expression {
  const onError = (message: string): never => fail(component, message);
  const fn = resolved.node;
  if (fn.async || fn.generator) {
    onError('memo-dom: JSX render functions must be synchronous');
  }
  const args = childNodes(call, 'arguments');
  if (args.some((argument) => argument.type === 'SpreadElement')) {
    onError('memo-dom: JSX render function calls do not support spread arguments');
  }
  if (args.length > fn.params.length) {
    onError('memo-dom: JSX render function received more arguments than parameters');
  }

  const substitutions = new Map<string, t.Expression>();
  for (let index = 0; index < fn.params.length; index++) {
    const parameter = fn.params[index]!;
    const argument = args[index];
    const argumentExpression =
      argument === undefined
        ? astFactory.identifier('undefined')
        : (argument as unknown as t.Expression);
    if (astFactory.isIdentifier(parameter)) {
      substitutions.set(parameter.name, cloneNode(argumentExpression));
      continue;
    }
    if (astFactory.isAssignmentPattern(parameter) && astFactory.isIdentifier(parameter.left)) {
      substitutions.set(
        parameter.left.name,
        astFactory.conditionalExpression(
          astFactory.binaryExpression(
            '===',
            cloneNode(argumentExpression),
            astFactory.identifier('undefined'),
          ),
          cloneNode(parameter.right),
          cloneNode(argumentExpression),
        ),
      );
      continue;
    }
    onError(
      'memo-dom: JSX render functions currently require identifier parameters with optional defaults',
    );
  }

  const planned = functionExpression(fn, onError);
  for (const [name, source] of planned.locals) {
    substitutions.set(name, substituteNode(source, substitutions));
  }
  const expression = substituteNode(planned.expression, substitutions);
  if (!nodeHasJsx(expression)) {
    onError('memo-dom: JSX render function expansion did not produce JSX');
  }
  return expression;
}

function bindingDeclarator(
  analysis: ScopeAnalysis,
  binding: Binding,
): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = analysis.parentByNode.get(current) ?? null;
  }
  return null;
}

function resolvedRenderIdentifier(
  ctx: Ctx,
  identifier: BaseNode,
): ResolvedRenderFunction | null {
  const name = identifierName(identifier);
  if (name === null) return null;
  const binding = astBindingAt(ctx, identifier, name);
  if (binding === undefined) return null;
  if (
    binding.kind === 'function' &&
    binding.declarationNode.type === 'FunctionDeclaration' &&
    nodeHasJsx(binding.declarationNode as unknown as t.Node)
  ) {
    return {
      node: binding.declarationNode as unknown as t.FunctionDeclaration,
      bindingNode: binding.declarationNode,
    };
  }
  const declaration = bindingDeclarator(ctx.astAnalysis!, binding);
  const initializer =
    declaration === null ? null : childNode(declaration, 'init');
  if (
    initializer !== null &&
    (initializer.type === 'FunctionExpression' ||
      initializer.type === 'ArrowFunctionExpression') &&
    nodeHasJsx(childNode(initializer, 'body') as unknown as t.Node)
  ) {
    return {
      node: initializer as unknown as t.FunctionExpression | t.ArrowFunctionExpression,
      bindingNode: declaration!,
    };
  }
  return null;
}

function resolvedRenderFunction(
  ctx: Ctx,
  call: BaseNode,
): ResolvedRenderFunction | null {
  const callee = childNode(call, 'callee');
  if (callee === null) return null;
  const inlineBody =
    callee.type === 'FunctionExpression' ||
    callee.type === 'ArrowFunctionExpression'
      ? childNode(callee, 'body')
      : null;
  if (
    inlineBody !== null &&
    nodeHasJsx(inlineBody as unknown as t.Node)
  ) {
    return {
      node: callee as unknown as t.FunctionExpression | t.ArrowFunctionExpression,
      bindingNode: null,
    };
  }
  return resolvedRenderIdentifier(ctx, callee);
}

function isMapCall(call: BaseNode): boolean {
  const callee = childNode(call, 'callee');
  return (
    callee?.type === 'MemberExpression' &&
    fields(callee).computed !== true &&
    identifierName(childNode(callee, 'property')) === 'map'
  );
}

function isRenderReference(
  analysis: ScopeAnalysis,
  reference: BaseNode,
): boolean {
  const call = analysis.parentByNode.get(reference) ?? null;
  return (
    call?.type === 'CallExpression' &&
    (childNode(call, 'callee') === reference ||
      (isMapCall(call) && childNodes(call, 'arguments')[0] === reference))
  );
}

function renderCallbackArrow(
  resolved: ResolvedRenderFunction,
  component: ComponentPath,
): t.ArrowFunctionExpression {
  const fn = resolved.node;
  if (fn.async || fn.generator) {
    fail(component, 'memo-dom: JSX render callbacks must be synchronous');
  }
  return astFactory.arrowFunctionExpression(
    fn.params.map(cloneNode),
    cloneNode(fn.body),
  );
}

function removalTarget(
  analysis: ScopeAnalysis,
  bindingNode: BaseNode,
): BaseNode {
  if (bindingNode.type === 'FunctionDeclaration') {
    const parent = analysis.parentByNode.get(bindingNode) ?? null;
    return parent?.type === 'ExportNamedDeclaration' ? parent : bindingNode;
  }
  if (bindingNode.type !== 'VariableDeclarator') return bindingNode;
  const declaration = analysis.parentByNode.get(bindingNode) ?? null;
  if (declaration?.type !== 'VariableDeclaration') return bindingNode;
  if (childNodes(declaration, 'declarations').length !== 1) return bindingNode;
  const parent = analysis.parentByNode.get(declaration) ?? null;
  return parent?.type === 'ExportNamedDeclaration' ? parent : declaration;
}

function replaceRenderCall(
  ctx: Ctx,
  call: BaseNode,
  expression: t.Expression,
): void {
  const analysis = ctx.astAnalysis!;
  const container = analysis.parentByNode.get(call) ?? null;
  const jsxParent =
    container === null ? null : analysis.parentByNode.get(container) ?? null;
  if (
    (astFactory.isJSXElement(expression) || astFactory.isJSXFragment(expression)) &&
    container?.type === 'JSXExpressionContainer' &&
    (jsxParent?.type === 'JSXElement' || jsxParent?.type === 'JSXFragment')
  ) {
    replaceNode(analysis, container, expression as unknown as BaseNode);
    return;
  }
  replaceNode(analysis, call, expression as unknown as BaseNode);
}

function currentProgram(ctx: Ctx): BaseNode {
  const root = ctx.astAnalysis?.rootScope.block;
  if (root === undefined || root.type !== 'Program') {
    throw new Error('memo-dom: missing ESTree program during render expansion');
  }
  return root;
}

/** Expand every locally resolvable JSX-returning call inside components. */
export function normalizeRenderFunctions(ctx: Ctx): void {
  const program = currentProgram(ctx);
  const usedBindings = new Set<BaseNode>();
  const removedBindings = new Set<BaseNode>();

  for (const [name, helper] of ctx.jsxHelpers) {
    const helperNode = helper.node as unknown as BaseNode;
    const binding = astBindingAt(ctx, helperNode, name);
    if (
      binding?.references.some(
        (reference) =>
          !isRenderReference(ctx.astAnalysis!, reference as unknown as BaseNode),
      )
    ) {
      throw helper.buildCodeFrameError(
        'memo-dom: JSX render functions may only be called in local render composition or passed directly to collection map()',
      );
    }
  }

  for (const [, componentPath] of ctx.compPaths) {
    const component = componentPath.node as unknown as BaseNode;
    const mapArguments: Array<{
      identifier: BaseNode;
      resolved: ResolvedRenderFunction;
    }> = [];
    walkAst<BaseNode>(component, {
      enter(current) {
        if (
          current.type !== 'CallExpression' ||
          !isMapCall(current) ||
          childNodes(current, 'arguments').length !== 1
        ) {
          return;
        }
        const argument = childNodes(current, 'arguments')[0]!;
        if (argument.type !== 'Identifier') return;
        const resolved = resolvedRenderIdentifier(ctx, argument);
        if (resolved !== null) mapArguments.push({ identifier: argument, resolved });
      },
    });
    for (const { identifier, resolved } of mapArguments) {
      replaceNode(
        ctx.astAnalysis!,
        identifier,
        renderCallbackArrow(resolved, componentPath) as unknown as BaseNode,
      );
      if (resolved.bindingNode !== null) {
        usedBindings.add(resolved.bindingNode);
      }
    }
    if (mapArguments.length > 0) refreshAstAnalysis(ctx, program);

    let changed = true;
    while (changed) {
      changed = false;
      const calls: BaseNode[] = [];
      walkAst<BaseNode>(component, {
        enter(current) {
          if (current.type === 'CallExpression') calls.push(current);
        },
      });
      for (const call of calls.reverse()) {
        const resolved = resolvedRenderFunction(ctx, call);
        if (resolved === null) continue;
        replaceRenderCall(ctx, call, instantiate(resolved, call, componentPath));
        if (resolved.bindingNode !== null) {
          usedBindings.add(resolved.bindingNode);
        }
        changed = true;
      }
      if (changed) refreshAstAnalysis(ctx, program);
    }
  }

  for (const [name, helper] of ctx.jsxHelpers) {
    const helperNode = helper.node as unknown as BaseNode;
    const binding = astBindingAt(ctx, helperNode, name);
    const bindingNode =
      binding === undefined
        ? helperNode
        : binding.declarationNode.type === 'FunctionDeclaration'
          ? binding.declarationNode
          : bindingDeclarator(ctx.astAnalysis!, binding) ?? helperNode;
    const target = removalTarget(ctx.astAnalysis!, bindingNode);
    removeNode(ctx.astAnalysis!, target);
    removedBindings.add(bindingNode);
  }
  for (const bindingNode of usedBindings) {
    if (removedBindings.has(bindingNode)) continue;
    removeNode(
      ctx.astAnalysis!,
      removalTarget(ctx.astAnalysis!, bindingNode),
    );
  }
  if (ctx.jsxHelpers.size > 0 || usedBindings.size > 0) {
    refreshAstAnalysis(ctx, program);
  }
}

/** Component-local JSX values are compile-time render aliases. */

import * as t from '@babel/types';
import {
  cloneNode as cloneAstNode,
  nodeIsWithin,
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

type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

interface StructuredCandidate {
  key: t.Expression;
  value: t.Expression;
}

type JsxChild =
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXSpreadChild
  | t.JSXElement
  | t.JSXFragment;

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function node(value: unknown): BaseNode | null {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as BaseNode)
    : null;
}

function childNode(parent: BaseNode, key: string): BaseNode | null {
  return node(fields(parent)[key]);
}

function identifierName(value: BaseNode | null): string | null {
  if (value?.type !== 'Identifier' && value?.type !== 'JSXIdentifier') {
    return null;
  }
  const name = fields(value).name;
  return typeof name === 'string' ? name : null;
}

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}

function fail(component: ComponentPath, message: string): never {
  throw component.buildCodeFrameError(`memo-dom: ${message}`);
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

function isRenderPosition(
  ctx: Ctx,
  reference: BaseNode,
): boolean {
  const analysis = ctx.astAnalysis!;
  let current = reference;
  while (true) {
    const parent = analysis.parentByNode.get(current) ?? null;
    if (parent === null) return false;
    if (parent.type === 'JSXAttribute' || parent.type === 'JSXSpreadAttribute') {
      return false;
    }
    if (parent.type === 'JSXExpressionContainer') {
      const containerParent = analysis.parentByNode.get(parent) ?? null;
      if (containerParent?.type === 'JSXAttribute') {
        const opening = analysis.parentByNode.get(containerParent) ?? null;
        if (opening?.type !== 'JSXOpeningElement') return false;
        const tag = identifierName(childNode(opening, 'name'));
        if (tag === null || !/^[A-Z]/.test(tag)) return false;
        const attributeNameNode = childNode(containerParent, 'name');
        const attributeName =
          identifierName(attributeNameNode) ??
          (attributeNameNode === null
            ? null
            : identifierName(childNode(attributeNameNode, 'name')));
        return (
          attributeName !== null &&
          ctx.componentProps.get(tag)?.renderProps.includes(attributeName) === true
        );
      }
      return (
        containerParent?.type === 'JSXElement' ||
        containerParent?.type === 'JSXFragment'
      );
    }
    if (
      parent.type === 'ReturnStatement' &&
      childNode(parent, 'argument') === current
    ) {
      return true;
    }
    if (
      parent.type === 'ArrowFunctionExpression' &&
      childNode(parent, 'body') === current
    ) {
      return true;
    }
    if (
      parent.type === 'VariableDeclarator' &&
      childNode(parent, 'init') === current
    ) {
      return true;
    }
    current = parent;
  }
}

function staticArray(
  ctx: Ctx,
  expression: BaseNode,
): t.ArrayExpression | null {
  if (expression.type === 'ArrayExpression') {
    return expression as unknown as t.ArrayExpression;
  }
  const name = identifierName(expression);
  if (name === null) return null;
  const binding = astBindingAt(ctx, expression, name);
  if (binding === undefined) return null;
  const declaration = bindingDeclarator(ctx.astAnalysis!, binding);
  const initializer =
    declaration === null ? null : childNode(declaration, 'init');
  return initializer?.type === 'ArrayExpression'
    ? (initializer as unknown as t.ArrayExpression)
    : null;
}

function isNonRenderingLiteral(value: BaseNode): boolean {
  if (value.type === 'NullLiteral' || value.type === 'BooleanLiteral') {
    return true;
  }
  return (
    value.type === 'Literal' &&
    (fields(value).value === null || typeof fields(value).value === 'boolean')
  );
}

function arrayChildren(
  ctx: Ctx,
  initializer: t.ArrayExpression,
  component: ComponentPath,
  visiting = new Set<BaseNode>(),
): JsxChild[] {
  const initializerNode = initializer as unknown as BaseNode;
  if (visiting.has(initializerNode)) {
    return fail(component, 'cyclic JSX array spread');
  }
  visiting.add(initializerNode);
  const children: JsxChild[] = [];
  try {
    for (const element of initializer.elements) {
      if (element == null || isNonRenderingLiteral(element as unknown as BaseNode)) {
        continue;
      }
      if (t.isSpreadElement(element)) {
        const spread = staticArray(ctx, element.argument as unknown as BaseNode);
        if (spread === null) {
          return fail(
            component,
            'JSX array spreads must resolve to a static JSX array',
          );
        }
        children.push(...arrayChildren(ctx, spread, component, visiting));
        continue;
      }
      if (t.isArrayExpression(element)) {
        children.push(...arrayChildren(ctx, element, component, visiting));
        continue;
      }
      if (t.isJSXElement(element) || t.isJSXFragment(element)) {
        children.push(cloneNode(element));
        continue;
      }
      children.push(
        t.jsxExpressionContainer(cloneNode(element as t.Expression)),
      );
    }
  } finally {
    visiting.delete(initializerNode);
  }
  return children;
}

function arrayFragment(
  ctx: Ctx,
  initializer: t.ArrayExpression,
  component: ComponentPath,
): t.JSXFragment {
  return t.jsxFragment(
    t.jsxOpeningFragment(),
    t.jsxClosingFragment(),
    arrayChildren(ctx, initializer, component),
  );
}

function literalValue(value: BaseNode): string | number | null {
  if (
    value.type !== 'StringLiteral' &&
    value.type !== 'NumericLiteral' &&
    value.type !== 'Literal'
  ) {
    return null;
  }
  const literal = fields(value).value;
  return typeof literal === 'string' || typeof literal === 'number'
    ? literal
    : null;
}

function structuredCandidates(
  initializer: t.ObjectExpression | t.ArrayExpression,
  component: ComponentPath,
): StructuredCandidate[] {
  if (t.isArrayExpression(initializer)) {
    return initializer.elements.map((element, index) => {
      if (element == null) {
        return fail(
          component,
          'JSX arrays cannot contain holes',
        );
      }
      if (t.isSpreadElement(element)) {
        return fail(
          component,
          'JSX array spreads must resolve to a static JSX array',
        );
      }
      return { key: t.numericLiteral(index), value: element as t.Expression };
    });
  }
  return initializer.properties.map((property) => {
    const propertyNode = property as unknown as BaseNode;
    if (
      (propertyNode.type !== 'ObjectProperty' &&
        propertyNode.type !== 'Property') ||
      fields(propertyNode).computed === true
    ) {
      return fail(
        component,
        'JSX objects require static data properties without spreads',
      );
    }
    const keyNode = childNode(propertyNode, 'key');
    const valueNode = childNode(propertyNode, 'value');
    if (keyNode === null || valueNode === null) {
      return fail(
        component,
        'JSX objects require static data properties without spreads',
      );
    }
    const name = identifierName(keyNode);
    const literal = literalValue(keyNode);
    const key =
      name !== null
        ? t.stringLiteral(name)
        : typeof literal === 'string'
          ? t.stringLiteral(literal)
          : typeof literal === 'number'
            ? t.numericLiteral(literal)
            : null;
    if (key === null) {
      return fail(
        component,
        'JSX objects require identifier, string, or numeric keys',
      );
    }
    return { key, value: valueNode as unknown as t.Expression };
  });
}

function selectedStructuredValue(
  member: BaseNode,
  candidates: readonly StructuredCandidate[],
  component: ComponentPath,
): t.Expression {
  const property = childNode(member, 'property');
  const computed = fields(member).computed === true;
  let selectedKey: string | number | null = null;
  if (!computed) selectedKey = identifierName(property);
  else if (property !== null) selectedKey = literalValue(property);

  if (selectedKey !== null) {
    const selected = candidates.find(
      (candidate) =>
        literalValue(candidate.key as unknown as BaseNode) === selectedKey,
    );
    if (selected === undefined) {
      return fail(
        component,
        `JSX collection has no entry for '${selectedKey}'`,
      );
    }
    return cloneNode(selected.value);
  }
  if (!computed || property === null) {
    return fail(
      component,
      'JSX collection selection requires a static or expression key',
    );
  }

  let selection: t.Expression = t.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    selection = t.conditionalExpression(
      t.binaryExpression(
        '===',
        cloneNode(property as unknown as t.Expression),
        cloneNode(candidate.key),
      ),
      cloneNode(candidate.value),
      selection,
    );
  }
  return selection;
}

function currentProgram(ctx: Ctx): BaseNode {
  const root = ctx.astAnalysis?.rootScope.block;
  if (root === undefined || root.type !== 'Program') {
    throw new Error('memo-dom: missing ESTree program during JSX normalization');
  }
  return root;
}

/** Expand component JSX aliases and statically structured JSX collections. */
export function normalizeComponentJsxValues(ctx: Ctx): void {
  const program = currentProgram(ctx);
  for (const [, componentPath] of ctx.compPaths) {
    const component = componentPath.node as unknown as BaseNode;
    let changed = false;

    const inlineArrays: BaseNode[] = [];
    walkAst<BaseNode>(component, {
      enter(current, parent) {
        if (
          current.type !== 'JSXExpressionContainer' ||
          (parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment')
        ) {
          return;
        }
        const expression = childNode(current, 'expression');
        if (
          expression?.type === 'ArrayExpression' &&
          nodeHasJsx(expression as unknown as t.Node)
        ) {
          inlineArrays.push(current);
        }
      },
    });
    for (const container of inlineArrays) {
      const expression = childNode(container, 'expression')!;
      replaceNode(
        ctx.astAnalysis!,
        container,
        arrayFragment(
          ctx,
          expression as unknown as t.ArrayExpression,
          componentPath,
        ) as unknown as BaseNode,
      );
      changed = true;
    }
    if (inlineArrays.length > 0) refreshAstAnalysis(ctx, program);

    let discovered = true;
    while (discovered) {
      discovered = false;
      const statements = componentPath.node.body.body;
      for (const statement of statements) {
        if (!t.isVariableDeclaration(statement, { kind: 'const' })) continue;
        for (const declaration of statement.declarations) {
          if (
            !t.isIdentifier(declaration.id) ||
            declaration.init == null ||
            !nodeHasJsx(declaration.init)
          ) {
            continue;
          }
          const declarationNode = declaration as unknown as BaseNode;
          const binding = astBindingAt(
            ctx,
            declarationNode,
            declaration.id.name,
          );
          if (
            binding === undefined ||
            bindingDeclarator(ctx.astAnalysis!, binding) !== declarationNode
          ) {
            continue;
          }
          const references = [...binding.references] as unknown as BaseNode[];
          const initializer = declaration.init;
          if (t.isObjectExpression(initializer) || t.isArrayExpression(initializer)) {
            const candidates = structuredCandidates(initializer, componentPath);
            for (const reference of references) {
              if (!nodeIsWithin(ctx.astAnalysis!, reference, component)) {
                fail(
                  componentPath,
                  `JSX collection '${declaration.id.name}' is used outside its component`,
                );
              }
              const parent = ctx.astAnalysis!.parentByNode.get(reference) ?? null;
              if (
                parent?.type === 'MemberExpression' &&
                childNode(parent, 'object') === reference
              ) {
                if (!isRenderPosition(ctx, parent)) {
                  fail(
                    componentPath,
                    `JSX collection '${declaration.id.name}' is used outside a render position`,
                  );
                }
                replaceNode(
                  ctx.astAnalysis!,
                  parent,
                  selectedStructuredValue(parent, candidates, componentPath) as unknown as BaseNode,
                );
                continue;
              }
              if (
                t.isArrayExpression(initializer) &&
                parent?.type === 'SpreadElement' &&
                (ctx.astAnalysis!.parentByNode.get(parent)?.type === 'ArrayExpression')
              ) {
                const outer = ctx.astAnalysis!.parentByNode.get(parent)! as unknown as t.ArrayExpression;
                const index = outer.elements.indexOf(
                  parent as unknown as t.SpreadElement,
                );
                if (index < 0) {
                  fail(componentPath, 'memo-dom: could not flatten JSX array spread');
                }
                outer.elements.splice(
                  index,
                  1,
                  ...initializer.elements.map((element) =>
                    element === null ? null : cloneNode(element),
                  ),
                );
                continue;
              }
              if (t.isArrayExpression(initializer) && isRenderPosition(ctx, reference)) {
                replaceNode(
                  ctx.astAnalysis!,
                  reference,
                  arrayFragment(ctx, initializer, componentPath) as unknown as BaseNode,
                );
                continue;
              }
              fail(
                componentPath,
                t.isArrayExpression(initializer)
                  ? `JSX collection '${declaration.id.name}' must be rendered directly or selected with a direct index access`
                  : `JSX collection '${declaration.id.name}' is used outside a render position`,
              );
            }
          } else {
            for (const reference of references) {
              if (!nodeIsWithin(ctx.astAnalysis!, reference, component)) continue;
              if (!isRenderPosition(ctx, reference)) {
                fail(
                  componentPath,
                  `JSX value '${declaration.id.name}' is used outside a render position`,
                );
              }
              replaceNode(
                ctx.astAnalysis!,
                reference,
                cloneNode(initializer) as unknown as BaseNode,
              );
            }
          }

          if (statement.declarations.length === 1) {
            removeNode(ctx.astAnalysis!, statement as unknown as BaseNode);
          } else {
            removeNode(ctx.astAnalysis!, declarationNode);
          }
          changed = true;
          discovered = true;
          refreshAstAnalysis(ctx, program);
          break;
        }
        if (discovered) break;
      }
    }

    if (!changed) continue;
    const containers: BaseNode[] = [];
    walkAst<BaseNode>(component, {
      enter(current, parent) {
        if (
          current.type !== 'JSXExpressionContainer' ||
          (parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment')
        ) {
          return;
        }
        const expression = childNode(current, 'expression');
        if (expression?.type === 'JSXElement' || expression?.type === 'JSXFragment') {
          containers.push(current);
        }
      },
    });
    for (const container of containers) {
      replaceNode(
        ctx.astAnalysis!,
        container,
        childNode(container, 'expression')!,
      );
    }
    refreshAstAnalysis(ctx, program);
  }
}

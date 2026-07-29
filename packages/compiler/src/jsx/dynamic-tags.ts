/**
 * Finite dynamic JSX tag lowering.
 *
 * Known string/component candidates become ordinary JSX branches selected by
 * the authored binding value. Existing conditional regions then own identity,
 * updates, and teardown without a runtime virtual-node representation.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { memberKey, memberRootName, type Ctx } from '../context';

interface DynamicTagCandidate {
  compare: t.Expression;
  tag: t.JSXIdentifier;
}

function unwrap(expression: t.Expression): t.Expression {
  let current = expression;
  while (
    t.isTSAsExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function jsxNameExpression(name: t.JSXIdentifier | t.JSXMemberExpression): t.Expression {
  if (t.isJSXIdentifier(name)) return t.identifier(name.name);
  return t.memberExpression(
    jsxNameExpression(name.object),
    t.identifier(name.property.name),
  );
}

function propertyValue(
  at: NodePath,
  expression: t.MemberExpression,
): t.Expression | null {
  const key = memberKey(expression);
  if (key === null) return null;
  const [root, ...segments] = key.split('.');
  if (root === undefined || segments.length === 0) return null;
  const binding = at.scope.getBinding(root);
  if (!binding?.path.isVariableDeclarator()) return null;
  let current = binding.path.node.init;
  if (current == null) return null;

  for (const segment of segments) {
    current = unwrap(current);
    if (!t.isObjectExpression(current)) return null;
    const property = current.properties.find((candidate) => {
      if (!t.isObjectProperty(candidate) || candidate.computed) return false;
      const name = t.isIdentifier(candidate.key)
        ? candidate.key.name
        : t.isStringLiteral(candidate.key)
          ? candidate.key.value
          : null;
      return name === segment;
    });
    if (
      property === undefined ||
      !t.isObjectProperty(property) ||
      !t.isExpression(property.value)
    ) {
      return null;
    }
    current = property.value;
  }
  return current;
}

function localFunctionReturns(
  at: NodePath,
  name: string,
): t.Expression[] {
  const binding = at.scope.getBinding(name);
  if (binding === undefined) return [];

  let fn:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression
    | null = null;
  if (binding.path.isFunctionDeclaration()) {
    fn = binding.path.node;
  } else if (
    binding.path.isVariableDeclarator() &&
    (t.isFunctionExpression(binding.path.node.init) ||
      t.isArrowFunctionExpression(binding.path.node.init))
  ) {
    fn = binding.path.node.init;
  }
  if (fn === null) return [];
  if (t.isExpression(fn.body)) return [fn.body];

  const returns: t.Expression[] = [];
  const visit = (node: t.Node): void => {
    if (t.isFunction(node)) return;
    if (t.isReturnStatement(node)) {
      if (t.isExpression(node.argument)) returns.push(node.argument);
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry != null && typeof entry === 'object' && 'type' in entry) {
            visit(entry as t.Node);
          }
        }
      } else if (
        child != null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        visit(child as t.Node);
      }
    }
  };
  for (const statement of fn.body.body) visit(statement);
  return returns;
}

function collectCandidates(
  ctx: Ctx,
  at: NodePath,
  expression: t.Expression,
  output: DynamicTagCandidate[],
  visiting = new Set<t.Node>(),
): void {
  const current = unwrap(expression);
  if (visiting.has(current)) return;
  visiting.add(current);

  if (t.isConditionalExpression(current)) {
    collectCandidates(ctx, at, current.consequent, output, visiting);
    collectCandidates(ctx, at, current.alternate, output, visiting);
    return;
  }
  if (t.isStringLiteral(current)) {
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(current.value)) {
      throw at.buildCodeFrameError(
        `memo-dom: '${current.value}' is not a valid dynamic intrinsic tag name`,
      );
    }
    output.push({
      compare: t.cloneNode(current),
      tag: t.jsxIdentifier(current.value),
    });
    return;
  }
  if (t.isIdentifier(current)) {
    if (ctx.comps.has(current.name) || ctx.importedComponents.has(current.name)) {
      output.push({
        compare: t.cloneNode(current),
        tag: t.jsxIdentifier(current.name),
      });
      return;
    }
    const stateCandidates = ctx.stateTagCandidates.get(current.name);
    if (stateCandidates !== undefined) {
      for (const candidate of stateCandidates) {
        collectCandidates(
          ctx,
          at,
          t.stringLiteral(candidate),
          output,
          visiting,
        );
      }
    }
    const binding = at.scope.getBinding(current.name);
    if (binding?.path.isVariableDeclarator() && binding.path.node.init != null) {
      collectCandidates(ctx, at, binding.path.node.init, output, visiting);
    }
    return;
  }
  if (t.isCallExpression(current) && t.isIdentifier(current.callee)) {
    for (const candidate of ctx.functionTagCandidates.get(current.callee.name) ??
      []) {
      collectCandidates(
        ctx,
        at,
        t.stringLiteral(candidate),
        output,
        visiting,
      );
    }
    for (const returned of localFunctionReturns(at, current.callee.name)) {
      collectCandidates(ctx, at, returned, output, visiting);
    }
    return;
  }
  if (t.isMemberExpression(current)) {
    const value = propertyValue(at, current);
    if (value !== null) {
      collectCandidates(ctx, at, value, output, visiting);
      return;
    }
    const root = memberRootName(current);
    if (root === null) return;
    for (const candidate of ctx.stateTagCandidates.get(root) ?? []) {
      collectCandidates(
        ctx,
        at,
        t.stringLiteral(candidate),
        output,
        visiting,
      );
    }
  }
}

function candidateKey(candidate: DynamicTagCandidate): string {
  return t.isStringLiteral(candidate.compare)
    ? `string:${candidate.compare.value}`
    : t.isIdentifier(candidate.compare)
      ? `component:${candidate.compare.name}`
      : JSON.stringify(candidate.compare);
}

function bindingInitializers(
  at: NodePath<t.JSXElement>,
  selector: t.Expression,
): t.Expression[] {
  if (t.isIdentifier(selector)) {
    const binding = at.scope.getBinding(selector.name);
    if (!binding?.path.isVariableDeclarator()) return [];
    return [
      ...(binding.path.node.init == null ? [] : [binding.path.node.init]),
      ...binding.constantViolations.flatMap((violation) => {
        if (
          violation.isAssignmentExpression() &&
          violation.node.operator === '=' &&
          t.isExpression(violation.node.right)
        ) {
          return [violation.node.right];
        }
        return [];
      }),
    ];
  }
  if (t.isMemberExpression(selector)) {
    const initial = propertyValue(at, selector);
    const key = memberKey(selector);
    const assignments: t.Expression[] = [];
    if (key !== null) {
      const functionOwner = at.getFunctionParent();
      const search = functionOwner ?? at.findParent((parent) => parent.isProgram());
      search?.traverse({
        AssignmentExpression(path) {
          if (
            path.node.operator === '=' &&
            t.isMemberExpression(path.node.left) &&
            memberKey(path.node.left) === key &&
            t.isExpression(path.node.right)
          ) {
            assignments.push(path.node.right);
          }
        },
      });
    }
    return [...(initial === null ? [] : [initial]), ...assignments];
  }
  return [];
}

function cloneWithTag(
  element: t.JSXElement,
  tag: t.JSXIdentifier,
): t.JSXElement {
  const clone = t.cloneNode(element, true);
  clone.openingElement.name = t.cloneNode(tag);
  const closingElement = clone.closingElement;
  if (closingElement != null) {
    closingElement.name = t.cloneNode(tag);
  }
  return clone;
}

function finiteSelection(
  selector: t.Expression,
  element: t.JSXElement,
  candidates: DynamicTagCandidate[],
): t.Expression {
  let selection: t.Expression = t.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    selection = t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.cloneNode(selector, true),
        t.cloneNode(candidate.compare, true),
      ),
      cloneWithTag(element, candidate.tag),
      selection,
    );
  }
  return selection;
}

function selectorName(selector: t.Expression): string {
  if (t.isIdentifier(selector)) return selector.name;
  if (t.isMemberExpression(selector)) {
    return memberKey(selector) ?? '<member expression>';
  }
  return '<expression>';
}

/** Lower dynamic identifier/member JSX names before component validation. */
export function normalizeDynamicTags(ctx: Ctx): void {
  for (const [, componentPath] of ctx.compPaths) {
    componentPath.scope.crawl();
    const elements: NodePath<t.JSXElement>[] = [];
    componentPath.traverse({
      JSXElement(elementPath) {
        elements.push(elementPath);
      },
    });

    // Normalize inside-out. Lowering a dynamic parent clones its authored
    // subtree into finite branches; nested selectors must already be lowered
    // so every clone carries the normalized conditional region.
    for (const elementPath of elements.reverse()) {
      if (elementPath.removed) continue;
      const name = elementPath.node.openingElement.name;
      if (t.isJSXNamespacedName(name)) {
        throw elementPath.buildCodeFrameError(
          'memo-dom: namespaced JSX tags are not supported',
        );
      }
      if (
        t.isJSXIdentifier(name) &&
        (!/^[A-Z]/.test(name.name) ||
          ctx.comps.has(name.name) ||
          ctx.importedComponents.has(name.name))
      ) {
        continue;
      }

      const selector = jsxNameExpression(name);
      const initializers = bindingInitializers(elementPath, selector);
      const candidates: DynamicTagCandidate[] = [];
      for (const initializer of initializers) {
        collectCandidates(ctx, elementPath, initializer, candidates);
      }
      const unique = [
        ...new Map(
          candidates.map((candidate) => [candidateKey(candidate), candidate]),
        ).values(),
      ];
      if (unique.length === 0) {
        throw elementPath.buildCodeFrameError(
          `memo-dom: dynamic JSX tag '${selectorName(
            selector,
          )}' has no finite string or linked-component candidates`,
        );
      }
      if (unique.length === 1) {
        elementPath.replaceWith(cloneWithTag(elementPath.node, unique[0]!.tag));
        continue;
      }

      elementPath.replaceWith(
        t.jsxFragment(
          t.jsxOpeningFragment(),
          t.jsxClosingFragment(),
          [
            t.jsxExpressionContainer(
              finiteSelection(selector, elementPath.node, unique),
            ),
          ],
        ),
      );
    }
    componentPath.scope.crawl();
  }
}

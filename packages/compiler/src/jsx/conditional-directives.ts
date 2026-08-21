/**
 * Normalize compiler-owned `if`, `else-if`, and `else` JSX directives.
 *
 * Sibling chains become the ordinary JSX-bearing conditional expressions that
 * the structural-region pipeline already understands. Formatting whitespace
 * and JSX comments do not interrupt a chain.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { JsxChild } from '../components/children';

type ConditionalParent = t.JSXElement | t.JSXFragment;
type ErrorPath = Pick<NodePath, 'buildCodeFrameError'>;
type DirectiveKind = 'if' | 'else-if' | 'else';

interface ConditionalDirective {
  kind: DirectiveKind;
  condition: t.Expression | null;
}

function directiveName(attribute: t.JSXAttribute): DirectiveKind | null {
  if (!t.isJSXIdentifier(attribute.name)) return null;
  const name = attribute.name.name;
  return name === 'if' || name === 'else-if' || name === 'else'
    ? name
    : null;
}

function readDirective(
  element: t.JSXElement,
  errorAt: ErrorPath,
): ConditionalDirective | null {
  let directive: ConditionalDirective | null = null;
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute)) continue;
    const kind = directiveName(attribute);
    if (kind === null) continue;
    if (directive !== null) {
      throw errorAt.buildCodeFrameError(
        'memo-dom: a JSX element may have only one of if, else-if, or else',
      );
    }
    if (kind === 'else') {
      if (attribute.value !== null) {
        throw errorAt.buildCodeFrameError(
          'memo-dom: the JSX else directive does not accept a value; write <Element else>',
        );
      }
      directive = { kind, condition: null };
      continue;
    }
    if (
      !t.isJSXExpressionContainer(attribute.value) ||
      t.isJSXEmptyExpression(attribute.value.expression) ||
      !t.isExpression(attribute.value.expression)
    ) {
      throw errorAt.buildCodeFrameError(
        `memo-dom: the JSX ${kind} directive requires an expression, for example ${kind}={condition}`,
      );
    }
    directive = {
      kind,
      condition: t.cloneNode(attribute.value.expression, true),
    };
  }
  return directive;
}

function removeDirective(element: t.JSXElement): void {
  element.openingElement.attributes = element.openingElement.attributes.filter(
    (attribute) =>
      !t.isJSXAttribute(attribute) || directiveName(attribute) === null,
  );
}

function isFormattingTrivia(child: JsxChild): boolean {
  return (
    (t.isJSXText(child) && child.value.trim() === '') ||
    (t.isJSXExpressionContainer(child) &&
      t.isJSXEmptyExpression(child.expression))
  );
}

function normalizeChildren(path: NodePath<ConditionalParent>): void {
  const children = path.node.children;
  if (children.length === 0) return;
  const childPaths = path.get('children') as NodePath<JsxChild>[];
  const paths = new Map<t.Node, NodePath<JsxChild>>(
    childPaths.map((childPath) => [childPath.node, childPath]),
  );
  const errorAt = (child: JsxChild): ErrorPath => paths.get(child) ?? path;
  const output: JsxChild[] = [];

  let index = 0;
  while (index < children.length) {
    const child = children[index]!;
    if (!t.isJSXElement(child)) {
      output.push(child);
      index++;
      continue;
    }

    const first = readDirective(child, errorAt(child));
    if (first?.kind === 'else-if' || first?.kind === 'else') {
      throw errorAt(child).buildCodeFrameError(
        `memo-dom: JSX ${first.kind} must immediately follow an if or else-if sibling`,
      );
    }
    if (first?.kind !== 'if') {
      output.push(child);
      index++;
      continue;
    }

    removeDirective(child);
    const conditionalBranches: Array<{
      condition: t.Expression;
      element: t.JSXElement;
    }> = [{ condition: first.condition!, element: child }];
    let finalElse: t.JSXElement | null = null;
    let cursor = index + 1;
    let trailingTrivia: JsxChild[] = [];

    while (cursor < children.length) {
      const trivia: JsxChild[] = [];
      while (cursor < children.length && isFormattingTrivia(children[cursor]!)) {
        trivia.push(children[cursor]!);
        cursor++;
      }
      if (cursor >= children.length) {
        trailingTrivia = trivia;
        break;
      }

      const candidate = children[cursor]!;
      if (!t.isJSXElement(candidate)) {
        trailingTrivia = trivia;
        break;
      }
      const next = readDirective(candidate, errorAt(candidate));
      if (next?.kind === 'else-if') {
        removeDirective(candidate);
        conditionalBranches.push({
          condition: next.condition!,
          element: candidate,
        });
        cursor++;
        continue;
      }
      if (next?.kind === 'else') {
        removeDirective(candidate);
        finalElse = candidate;
        cursor++;
        while (cursor < children.length && isFormattingTrivia(children[cursor]!)) {
          trailingTrivia.push(children[cursor]!);
          cursor++;
        }
      } else {
        trailingTrivia = trivia;
      }
      break;
    }

    let expression: t.Expression = finalElse ?? t.nullLiteral();
    for (let branch = conditionalBranches.length - 1; branch >= 0; branch--) {
      const item = conditionalBranches[branch]!;
      expression = t.conditionalExpression(
        item.condition,
        item.element,
        expression,
      );
    }
    output.push(t.jsxExpressionContainer(expression), ...trailingTrivia);
    index = cursor;
  }

  path.node.children = output;
}

/** Lower conditional JSX directives before route and reactivity analysis. */
export function normalizeConditionalJsxDirectives(
  programPath: NodePath<t.Program>,
): void {
  programPath.traverse({
    JSXElement: {
      exit(path) {
        normalizeChildren(path);
      },
    },
    JSXFragment: {
      exit(path) {
        normalizeChildren(path);
      },
    },
  });

  // An `if` element used outside a JSX sibling list still gets conditional
  // semantics. A fragment keeps component returns in the compiler's supported
  // direct-JSX shape.
  programPath.traverse({
    JSXElement(path) {
      const directive = readDirective(path.node, path);
      if (directive === null) return;
      if (directive.kind !== 'if') {
        throw path.buildCodeFrameError(
          `memo-dom: JSX ${directive.kind} must immediately follow an if or else-if sibling`,
        );
      }
      removeDirective(path.node);
      const element = path.node;
      path.replaceWith(
        t.jsxFragment(
          t.jsxOpeningFragment(),
          t.jsxClosingFragment(),
          [
            t.jsxExpressionContainer(
              t.conditionalExpression(
                directive.condition!,
                element,
                t.nullLiteral(),
              ),
            ),
          ],
        ),
      );
      path.skip();
    },
  });
}

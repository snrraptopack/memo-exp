/**
 * Normalize compiler-owned `if`, `else-if`, and `else` JSX directives.
 *
 * Sibling chains become the ordinary JSX-bearing conditional expressions that
 * the structural-region pipeline already understands. Formatting whitespace
 * and JSX comments do not interrupt a chain.
 */
import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { walkAst, type BaseNode } from '../ast';
import type { JsxChild } from '../components/children';

type ConditionalParent = t.JSXElement | t.JSXFragment;
type DirectiveKind = 'if' | 'else-if' | 'else';

interface ErrorPath {
  buildCodeFrameError(message: string): Error;
}

interface ProgramContainer extends ErrorPath {
  node: t.Program;
  scope?: { crawl(): void };
}

interface ConditionalDirective {
  kind: DirectiveKind;
  condition: t.Expression | null;
}

function directiveName(attribute: t.JSXAttribute): DirectiveKind | null {
  if (!astFactory.isJSXIdentifier(attribute.name)) return null;
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
    if (!astFactory.isJSXAttribute(attribute)) continue;
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
      !astFactory.isJSXExpressionContainer(attribute.value) ||
      astFactory.isJSXEmptyExpression(attribute.value.expression) ||
      !astFactory.isExpression(attribute.value.expression)
    ) {
      throw errorAt.buildCodeFrameError(
        `memo-dom: the JSX ${kind} directive requires an expression, for example ${kind}={condition}`,
      );
    }
    directive = {
      kind,
      condition: cloneEstreeNode(attribute.value.expression, true),
    };
  }
  return directive;
}

function removeDirective(element: t.JSXElement): void {
  element.openingElement.attributes = element.openingElement.attributes.filter(
    (attribute) =>
      !astFactory.isJSXAttribute(attribute) || directiveName(attribute) === null,
  );
}

function isFormattingTrivia(child: JsxChild): boolean {
  return (
    (astFactory.isJSXText(child) && child.value.trim() === '') ||
    (astFactory.isJSXExpressionContainer(child) &&
      astFactory.isJSXEmptyExpression(child.expression))
  );
}

function normalizeChildren(
  parent: ConditionalParent,
  errorAt: ErrorPath,
): void {
  const children = parent.children;
  if (children.length === 0) return;
  const output: JsxChild[] = [];

  let index = 0;
  while (index < children.length) {
    const child = children[index]!;
    if (!astFactory.isJSXElement(child)) {
      output.push(child);
      index++;
      continue;
    }

    const first = readDirective(child, errorAt);
    if (first?.kind === 'else-if' || first?.kind === 'else') {
      throw errorAt.buildCodeFrameError(
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
      if (!astFactory.isJSXElement(candidate)) {
        trailingTrivia = trivia;
        break;
      }
      const next = readDirective(candidate, errorAt);
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

    let expression: t.Expression = finalElse ?? astFactory.nullLiteral();
    for (let branch = conditionalBranches.length - 1; branch >= 0; branch--) {
      const item = conditionalBranches[branch]!;
      expression = astFactory.conditionalExpression(
        item.condition,
        item.element,
        expression,
      );
    }
    output.push(astFactory.jsxExpressionContainer(expression), ...trailingTrivia);
    index = cursor;
  }

  parent.children = output;
}

function replaceChild(
  parent: BaseNode,
  key: string | undefined,
  index: number | undefined,
  replacement: BaseNode,
): void {
  if (key === undefined) return;
  const fields = parent as unknown as Record<string, unknown>;
  if (index === undefined) {
    fields[key] = replacement;
    return;
  }
  const children = fields[key];
  if (Array.isArray(children)) children[index] = replacement;
}

/** Lower conditional JSX directives before route and reactivity analysis. */
export function normalizeConditionalJsxDirectives(
  programPath: ProgramContainer,
): void {
  walkAst<BaseNode>(programPath.node, {
    leave(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        normalizeChildren(node as unknown as ConditionalParent, programPath);
      }
    },
  });

  // An `if` element used outside a JSX sibling list still gets conditional
  // semantics. A fragment keeps component returns in the compiler's supported
  // direct-JSX shape.
  walkAst<BaseNode>(programPath.node, {
    enter(node, parent, key, index) {
      if (node.type !== 'JSXElement') return;
      const element = node as unknown as t.JSXElement;
      const directive = readDirective(element, programPath);
      if (directive === null) return;
      if (directive.kind !== 'if') {
        throw programPath.buildCodeFrameError(
          `memo-dom: JSX ${directive.kind} must immediately follow an if or else-if sibling`,
        );
      }
      removeDirective(element);
      const fragment = astFactory.jsxFragment(
        astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(),
        [
          astFactory.jsxExpressionContainer(
            astFactory.conditionalExpression(
              directive.condition!,
              element,
              astFactory.nullLiteral(),
            ),
          ),
        ],
      );
      if (parent !== null) replaceChild(parent, key, index, fragment);
      return false;
    },
  });
  programPath.scope?.crawl();
}

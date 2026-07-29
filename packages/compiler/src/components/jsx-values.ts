/**
 * Component-local JSX values are compile-time render aliases.
 *
 * Expanding them before analysis lets the normal host/component/list/region
 * passes retain direct DOM emission without introducing a virtual-node value.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx, type Ctx } from '../context';

function belongsToComponent(
  reference: NodePath<t.Identifier>,
  componentPath: NodePath<t.FunctionDeclaration>,
): boolean {
  const owner = reference.findParent(
    (parent) =>
      parent.isFunctionDeclaration() ||
      parent.isFunctionExpression() ||
      parent.isArrowFunctionExpression(),
  );
  if (owner === componentPath) return true;
  return owner?.findParent((parent) => parent === componentPath) !== null;
}

function isRenderPosition(reference: NodePath<t.Identifier>): boolean {
  let current: NodePath | null = reference;
  while (current !== null) {
    const parent: NodePath | null = current.parentPath;
    if (parent === null) return false;
    if (parent.isJSXAttribute() || parent.isJSXSpreadAttribute()) return false;
    if (parent.isJSXExpressionContainer()) {
      return (
        parent.parentPath?.isJSXElement() === true ||
        parent.parentPath?.isJSXFragment() === true
      );
    }
    if (parent.isReturnStatement() && parent.node.argument === current.node) {
      return true;
    }
    if (
      parent.isArrowFunctionExpression() &&
      parent.node.body === current.node
    ) {
      return true;
    }
    if (
      parent.isVariableDeclarator() &&
      parent.node.init === current.node
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

/**
 * Expand top-level component `const view = <JSX />` aliases at each render
 * use. Aliases may chain and may hold JSX-bearing conditional expressions.
 */
export function normalizeComponentJsxValues(ctx: Ctx): void {
  for (const [, componentPath] of ctx.compPaths) {
    let changed = false;
    let discovered = true;

    while (discovered) {
      discovered = false;
      componentPath.scope.crawl();
      const statements = componentPath.get('body').get('body');

      for (const statementPath of statements) {
        if (!statementPath.isVariableDeclaration({ kind: 'const' })) continue;
        for (const declarationPath of statementPath.get('declarations')) {
          const declaration = declarationPath.node;
          const initializer = declaration.init;
          if (
            !t.isIdentifier(declaration.id) ||
            initializer == null ||
            !nodeHasJsx(initializer)
          ) {
            continue;
          }

          const binding = declarationPath.scope.getBinding(declaration.id.name);
          if (binding?.path !== declarationPath) continue;
          const references = [...binding.referencePaths];
          for (const reference of references) {
            if (
              !reference.isIdentifier() ||
              !belongsToComponent(reference, componentPath)
            ) {
              continue;
            }
            if (!isRenderPosition(reference)) {
              throw reference.buildCodeFrameError(
                `memo-dom: JSX value '${declaration.id.name}' is used outside a render position`,
              );
            }
            reference.replaceWith(t.cloneNode(initializer, true));
          }

          if (statementPath.node.declarations.length === 1) {
            statementPath.remove();
          } else {
            declarationPath.remove();
          }
          changed = true;
          discovered = true;
          break;
        }
        if (discovered) break;
      }
    }

    if (changed) {
      componentPath.traverse({
        JSXExpressionContainer(containerPath) {
          const expression = containerPath.node.expression;
          if (t.isJSXElement(expression) || t.isJSXFragment(expression)) {
            containerPath.replaceWith(expression);
          }
        },
      });
      componentPath.scope.crawl();
    }
  }
}

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

function isRenderPosition(
  reference: NodePath,
  ctx: Ctx,
): boolean {
  let current: NodePath | null = reference;
  while (current !== null) {
    const parent: NodePath | null = current.parentPath;
    if (parent === null) return false;
    if (parent.isJSXAttribute() || parent.isJSXSpreadAttribute()) return false;
    if (parent.isJSXExpressionContainer()) {
      if (parent.parentPath?.isJSXAttribute() === true) {
        const attribute = parent.parentPath.node;
        const opening = parent.parentPath.parentPath;
        if (!opening?.isJSXOpeningElement()) return false;
        const tag = opening.node.name;
        if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return false;
        const attrName = t.isJSXIdentifier(attribute.name)
          ? attribute.name.name
          : attribute.name.name.name;
        return (
          ctx.componentProps
            .get(tag.name)
            ?.renderProps.includes(attrName) === true
        );
      }
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

interface StructuredCandidate {
  key: t.Expression;
  value: t.Expression;
}

function structuredCandidates(
  initializer: t.ObjectExpression | t.ArrayExpression,
  at: NodePath,
): StructuredCandidate[] {
  if (t.isArrayExpression(initializer)) {
    return initializer.elements.map((element, index) => {
      if (element == null || t.isSpreadElement(element)) {
        throw at.buildCodeFrameError(
          'memo-dom: JSX arrays cannot contain holes or spread elements',
        );
      }
      return {
        key: t.numericLiteral(index),
        value: element as t.Expression,
      };
    });
  }
  return initializer.properties.map((property) => {
    if (
      !t.isObjectProperty(property) ||
      property.computed ||
      !t.isExpression(property.value)
    ) {
      throw at.buildCodeFrameError(
        'memo-dom: JSX objects require static data properties without spreads',
      );
    }
    const key = t.isIdentifier(property.key)
      ? t.stringLiteral(property.key.name)
      : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)
        ? t.cloneNode(property.key)
        : null;
    if (key === null) {
      throw at.buildCodeFrameError(
        'memo-dom: JSX objects require identifier, string, or numeric keys',
      );
    }
    return {
      key,
      value: property.value,
    };
  });
}

function selectedStructuredValue(
  memberPath: NodePath<t.MemberExpression>,
  candidates: readonly StructuredCandidate[],
): t.Expression {
  const member = memberPath.node;
  let selectedKey: string | number | null = null;
  if (!member.computed && t.isIdentifier(member.property)) {
    selectedKey = member.property.name;
  } else if (
    member.computed &&
    (t.isStringLiteral(member.property) || t.isNumericLiteral(member.property))
  ) {
    selectedKey = member.property.value;
  }
  if (selectedKey !== null) {
    const selected = candidates.find(
      (candidate) =>
        (t.isStringLiteral(candidate.key) ||
          t.isNumericLiteral(candidate.key)) &&
        candidate.key.value === selectedKey,
    );
    if (selected === undefined) {
      throw memberPath.buildCodeFrameError(
        `memo-dom: JSX collection has no entry for '${selectedKey}'`,
      );
    }
    return t.cloneNode(selected.value, true);
  }
  if (!member.computed || !t.isExpression(member.property)) {
    throw memberPath.buildCodeFrameError(
      'memo-dom: JSX collection selection requires a static or expression key',
    );
  }

  let selection: t.Expression = t.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    selection = t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.cloneNode(member.property, true),
        t.cloneNode(candidate.key, true),
      ),
      t.cloneNode(candidate.value, true),
      selection,
    );
  }
  return selection;
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
          if (
            t.isObjectExpression(initializer) ||
            t.isArrayExpression(initializer)
          ) {
            const candidates = structuredCandidates(initializer, declarationPath);
            for (const reference of references) {
              if (
                !reference.isIdentifier() ||
                !belongsToComponent(reference, componentPath) ||
                !reference.parentPath?.isMemberExpression() ||
                reference.parentPath.node.object !== reference.node
              ) {
                throw reference.buildCodeFrameError(
                  `memo-dom: JSX collection '${declaration.id.name}' must be selected with a direct property or index access`,
                );
              }
              const memberPath = reference.parentPath;
              if (!isRenderPosition(memberPath, ctx)) {
                throw memberPath.buildCodeFrameError(
                  `memo-dom: JSX collection '${declaration.id.name}' is used outside a render position`,
                );
              }
              memberPath.replaceWith(
                selectedStructuredValue(memberPath, candidates),
              );
            }
          } else {
          for (const reference of references) {
            if (
              !reference.isIdentifier() ||
              !belongsToComponent(reference, componentPath)
            ) {
              continue;
            }
            if (!isRenderPosition(reference, ctx)) {
              throw reference.buildCodeFrameError(
                `memo-dom: JSX value '${declaration.id.name}' is used outside a render position`,
              );
            }
            reference.replaceWith(t.cloneNode(initializer, true));
          }
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
          if (
            (containerPath.parentPath?.isJSXElement() === true ||
              containerPath.parentPath?.isJSXFragment() === true) &&
            (t.isJSXElement(expression) || t.isJSXFragment(expression))
          ) {
            containerPath.replaceWith(expression);
          }
        },
      });
      componentPath.scope.crawl();
    }
  }
}

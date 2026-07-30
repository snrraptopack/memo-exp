/**
 * jsx/refs.ts - compile DOM ref values and mount them with structural cleanup.
 *
 * Assignable source expressions are sinks, not reads. They become ordinary
 * callback adapters so forwarding needs no public ref wrapper or special key.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Ctx } from '../context';
import { renderPropReferenceName } from '../components/children';
import { generatedIdentifier, md } from '../identifiers';
import type { EmitScope } from '../emission/scope';

/** Compile one source ref into callback/array values understood by mountRef. */
export function compileRefValue(
  ctx: Ctx,
  componentPath: NodePath<t.FunctionDeclaration>,
  componentName: string,
  expression: t.Expression,
): t.Expression {
  if (t.isArrayExpression(expression)) {
    return t.arrayExpression(
      expression.elements.map((element) => {
        if (element === null) return null;
        if (t.isSpreadElement(element)) {
          throw componentPath.buildCodeFrameError(
            'memo-dom: ref arrays must have a static shape; nested arrays are supported but array spreads are not',
          );
        }
        return compileRefValue(
          ctx,
          componentPath,
          componentName,
          element,
        );
      }),
    );
  }

  if (isForwardedRef(ctx, componentName, expression)) {
    return t.cloneNode(expression, true);
  }
  if (isMutableIdentifier(componentPath, expression)) {
    return mutableAdapter(ctx, expression);
  }
  if (t.isMemberExpression(expression)) {
    return mutableAdapter(ctx, expression);
  }
  return t.cloneNode(expression, true);
}

/** Emit one mount operation and attach its disposer to this scope's policy. */
export function emitRefMount(
  ctx: Ctx,
  scope: EmitScope,
  node: t.Expression,
  ownerId: t.Expression,
  value: t.Expression,
): void {
  const disposer = generatedIdentifier(ctx, 'refDispose');
  scope.mounts.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(disposer),
        t.callExpression(md(ctx, 'mountRef'), [
          t.cloneNode(node, true),
          t.cloneNode(value, true),
        ]),
      ),
    ]),
  );
  if (scope.manualDisposal) {
    scope.disposableCallbacks.push(disposer);
  } else {
    scope.mounts.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'cleanup'), [
          t.cloneNode(ownerId, true),
          t.cloneNode(disposer),
        ]),
      ),
    );
  }
}

function isForwardedRef(
  ctx: Ctx,
  componentName: string,
  expression: t.Expression,
): boolean {
  const prop = renderPropReferenceName(ctx, componentName, expression);
  return (
    prop !== null &&
    ctx.componentProps.get(componentName)?.refProps.includes(prop) === true
  );
}

function isMutableIdentifier(
  componentPath: NodePath<t.FunctionDeclaration>,
  expression: t.Expression,
): expression is t.Identifier {
  if (!t.isIdentifier(expression) || expression.name === 'undefined') {
    return false;
  }
  const binding = componentPath.scope.getBinding(expression.name);
  if (binding === undefined) return false;
  if (binding.path.isFunctionDeclaration()) return false;
  if (
    binding.path.isImportSpecifier() ||
    binding.path.isImportDefaultSpecifier() ||
    binding.path.isImportNamespaceSpecifier()
  ) {
    return false;
  }
  if (binding.path.isVariableDeclarator()) {
    const declaration = binding.path.parentPath;
    if (declaration.isVariableDeclaration({ kind: 'const' })) return false;
    const init = binding.path.node.init;
    if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
      return false;
    }
  }
  return binding.kind !== 'param';
}

function mutableAdapter(
  ctx: Ctx,
  target: t.Identifier | t.MemberExpression,
): t.ArrowFunctionExpression {
  const node = generatedIdentifier(ctx, 'refNode');
  if (t.isMemberExpression(target)) {
    const receiver = generatedIdentifier(ctx, 'refTarget');
    const key = target.computed
      ? generatedIdentifier(ctx, 'refKey')
      : null;
    const member = (): t.MemberExpression =>
      t.memberExpression(
        t.cloneNode(receiver),
        key === null
          ? t.cloneNode(target.property, true)
          : t.cloneNode(key),
        target.computed,
      );
    return t.arrowFunctionExpression(
      [t.cloneNode(node)],
      t.blockStatement([
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.cloneNode(receiver),
            t.cloneNode(target.object, true) as t.Expression,
          ),
          ...(key === null
            ? []
            : [
                t.variableDeclarator(
                  t.cloneNode(key),
                  t.cloneNode(target.property, true) as t.Expression,
                ),
              ]),
        ]),
        t.expressionStatement(
          t.assignmentExpression('=', member(), t.cloneNode(node)),
        ),
        t.returnStatement(
          t.arrowFunctionExpression(
            [],
            t.blockStatement([
              t.ifStatement(
                t.binaryExpression(
                  '===',
                  member(),
                  t.cloneNode(node),
                ),
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    member(),
                    t.identifier('undefined'),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
  return t.arrowFunctionExpression(
    [t.cloneNode(node)],
    t.blockStatement([
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.cloneNode(target, true),
          t.cloneNode(node),
        ),
      ),
      t.returnStatement(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.ifStatement(
              t.binaryExpression(
                '===',
                t.cloneNode(target, true),
                t.cloneNode(node),
              ),
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.cloneNode(target, true),
                  t.identifier('undefined'),
                ),
              ),
            ),
          ]),
        ),
      ),
    ]),
  );
}

/**
 * jsx/refs.ts - compile DOM ref values and mount them with structural cleanup.
 *
 * Assignable source expressions are sinks, not reads. They become ordinary
 * callback adapters so forwarding needs no public ref wrapper or special key.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type BaseNode } from '../ast';
import { astBindingAt, type ComponentPath, type Ctx } from '../context';
import { renderPropReferenceName } from '../components/children';
import { generatedIdentifier, md } from '../identifiers';
import type { EmitScope } from '../emission/scope';

/** Compile one source ref into callback/array values understood by mountRef. */
export function compileRefValue(
  ctx: Ctx,
  componentPath: ComponentPath,
  componentName: string,
  expression: t.Expression,
): t.Expression {
  if (astFactory.isArrayExpression(expression)) {
    return astFactory.arrayExpression(
      expression.elements.map((element) => {
        if (element === null) return null;
        if (astFactory.isSpreadElement(element)) {
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
    return cloneEstreeNode(expression, true);
  }
  if (isMutableIdentifier(ctx, componentPath, expression)) {
    return mutableAdapter(ctx, expression);
  }
  if (astFactory.isMemberExpression(expression)) {
    return mutableAdapter(ctx, expression);
  }
  return cloneEstreeNode(expression, true);
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
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(disposer),
        astFactory.callExpression(md(ctx, 'mountRef'), [
          cloneEstreeNode(node, true),
          cloneEstreeNode(value, true),
        ]),
      ),
    ]),
  );
  if (scope.manualDisposal) {
    scope.disposableCallbacks.push(disposer);
  } else {
    scope.mounts.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'cleanup'), [
          cloneEstreeNode(ownerId, true),
          cloneEstreeNode(disposer),
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
  ctx: Ctx,
  componentPath: ComponentPath,
  expression: t.Expression,
): expression is t.Identifier {
  if (!astFactory.isIdentifier(expression) || expression.name === 'undefined') {
    return false;
  }
  const binding = astBindingAt(
    ctx,
    componentPath.node as unknown as BaseNode,
    expression.name,
  );
  if (binding === undefined) return false;
  if (
    binding.declarationNode.type === 'FunctionDeclaration' ||
    binding.declarationNode.type === 'ImportDeclaration'
  ) {
    return false;
  }
  if (binding.kind === 'const') return false;
  const declarator = ctx.astAnalysis?.parentByNode.get(binding.identifier);
  if (declarator?.type === 'VariableDeclarator') {
    const init = (declarator as unknown as { init?: BaseNode | null }).init;
    if (
      init?.type === 'FunctionExpression' ||
      init?.type === 'ArrowFunctionExpression'
    ) {
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
  if (astFactory.isMemberExpression(target)) {
    const receiver = generatedIdentifier(ctx, 'refTarget');
    const key = target.computed
      ? generatedIdentifier(ctx, 'refKey')
      : null;
    const member = (): t.MemberExpression =>
      astFactory.memberExpression(
        cloneEstreeNode(receiver),
        key === null
          ? cloneEstreeNode(target.property, true)
          : cloneEstreeNode(key),
        target.computed,
      );
    return astFactory.arrowFunctionExpression(
      [cloneEstreeNode(node)],
      astFactory.blockStatement([
        astFactory.variableDeclaration('const', [
          astFactory.variableDeclarator(
            cloneEstreeNode(receiver),
            cloneEstreeNode(target.object, true) as t.Expression,
          ),
          ...(key === null
            ? []
            : [
                astFactory.variableDeclarator(
                  cloneEstreeNode(key),
                  cloneEstreeNode(target.property, true) as t.Expression,
                ),
              ]),
        ]),
        astFactory.expressionStatement(
          astFactory.assignmentExpression('=', member(), cloneEstreeNode(node)),
        ),
        astFactory.returnStatement(
          astFactory.arrowFunctionExpression(
            [],
            astFactory.blockStatement([
              astFactory.ifStatement(
                astFactory.binaryExpression(
                  '===',
                  member(),
                  cloneEstreeNode(node),
                ),
                astFactory.expressionStatement(
                  astFactory.assignmentExpression(
                    '=',
                    member(),
                    astFactory.identifier('undefined'),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
  return astFactory.arrowFunctionExpression(
    [cloneEstreeNode(node)],
    astFactory.blockStatement([
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(target, true),
          cloneEstreeNode(node),
        ),
      ),
      astFactory.returnStatement(
        astFactory.arrowFunctionExpression(
          [],
          astFactory.blockStatement([
            astFactory.ifStatement(
              astFactory.binaryExpression(
                '===',
                cloneEstreeNode(target, true),
                cloneEstreeNode(node),
              ),
              astFactory.expressionStatement(
                astFactory.assignmentExpression(
                  '=',
                  cloneEstreeNode(target, true),
                  astFactory.identifier('undefined'),
                ),
              ),
            ),
          ]),
        ),
      ),
    ]),
  );
}

/**
 * Compile ref values for any target that supplies element handles.
 *
 * Assignable source expressions are sinks, not reads. They become ordinary
 * callback adapters so forwarding needs no public ref wrapper or special key.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { type BaseNode } from '../ast';
import { astBindingAt, type ComponentPath } from '../context';
import type { Ctx } from '../context';
import { renderPropReferenceName } from '../analysis/render-prop-reference';
export interface RefEmission {
  fresh(name: string): t.Identifier;
  runtime(name: string): t.Expression;
}
/** Compile one source ref into callback/array values understood by mountRef. */
export function compileRefValue(
  ctx: Ctx,
  componentPath: ComponentPath,
  componentName: string,
  expression: t.Expression,
  emitter: RefEmission,
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
        return compileRefValue(ctx, componentPath, componentName, element, emitter);
      }),
    );
  }

  if (isForwardedRef(ctx, componentName, expression)) {
    return cloneEstreeNode(expression, true);
  }
  if (isMutableIdentifier(ctx, componentPath, expression)) {
    return assignAdapter(emitter, expression);
  }
  if (astFactory.isMemberExpression(expression)) {
    return assignAdapter(emitter, expression);
  }
  return cloneEstreeNode(expression, true);
}

function isForwardedRef(ctx: Ctx, componentName: string, expression: t.Expression): boolean {
  const prop = renderPropReferenceName(ctx, componentName, expression);
  return prop !== null && ctx.componentProps.get(componentName)?.refProps.includes(prop) === true;
}

function isMutableIdentifier(
  ctx: Ctx,
  componentPath: ComponentPath,
  expression: t.Expression,
): expression is t.Identifier {
  if (!astFactory.isIdentifier(expression) || expression.name === 'undefined') {
    return false;
  }
  const binding = astBindingAt(ctx, componentPath.node as unknown as BaseNode, expression.name);
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
    if (init?.type === 'FunctionExpression' || init?.type === 'ArrowFunctionExpression') {
      return false;
    }
  }
  return binding.kind !== 'param';
}

/**
 * Assignable-target adapters are pure writes, so emitted code marks them
 * through `refAssign`. Each target decides when its element is ready; the
 * shared runtime retains callback ordering and reverse disposal.
 */
function assignAdapter(
  emitter: RefEmission,
  target: t.Identifier | t.MemberExpression,
): t.CallExpression {
  return astFactory.callExpression(emitter.runtime('refAssign'), [mutableAdapter(emitter, target)]);
}

function mutableAdapter(
  emitter: RefEmission,
  target: t.Identifier | t.MemberExpression,
): t.ArrowFunctionExpression {
  const node = emitter.fresh('refNode');
  if (astFactory.isMemberExpression(target)) {
    const receiver = emitter.fresh('refTarget');
    const key = target.computed ? emitter.fresh('refKey') : null;
    const member = (): t.MemberExpression =>
      astFactory.memberExpression(
        cloneEstreeNode(receiver),
        key === null ? cloneEstreeNode(target.property, true) : cloneEstreeNode(key),
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
                astFactory.binaryExpression('===', member(), cloneEstreeNode(node)),
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
        astFactory.assignmentExpression('=', cloneEstreeNode(target, true), cloneEstreeNode(node)),
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

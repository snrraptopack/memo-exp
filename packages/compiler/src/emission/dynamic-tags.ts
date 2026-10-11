/** Host-independent JSX replacement for the shared finite-tag plan. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneAstNode, replaceNode, type BaseNode } from '../ast';
import { refreshAstAnalysis, type Ctx } from '../context';
import type { DynamicTagCandidate, DynamicTagPlan } from '../planning/dynamic-tags';

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}
function cloneWithTag(element: t.JSXElement, tag: t.JSXIdentifier): t.JSXElement {
  const clone = cloneNode(element);
  clone.openingElement.name = cloneNode(tag);
  if (clone.closingElement != null) clone.closingElement.name = cloneNode(tag);
  return clone;
}

function finiteSelection(
  scratch: string,
  selector: t.Expression,
  element: t.JSXElement,
  candidates: readonly DynamicTagCandidate[],
): t.Expression {
  // The selection becomes a cond-region pick that re-evaluates on every
  // update. Evaluate the selector once per pick through a shared scratch
  // binding instead of re-running it inside every candidate comparison.
  let selection: t.Expression = astFactory.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    const selected = astFactory.identifier(scratch);
    selection = astFactory.conditionalExpression(
      astFactory.binaryExpression(
        '===',
        index === 0
          ? astFactory.assignmentExpression('=', selected, cloneNode(selector))
          : selected,
        cloneNode(candidate.compare),
      ),
      cloneWithTag(element, astFactory.jsxIdentifier(candidate.name)),
      selection,
    );
  }
  return selection;
}

/** Replace finite tag selections before either target performs semantic scans. */
export function lowerPlannedDynamicTags(
  ctx: Ctx,
  plan: DynamicTagPlan,
  scratch: () => string,
): void {
  const program = ctx.astAnalysis!.rootScope.block;
  for (const { path, hasJsx, sites } of plan.components) {
    for (const site of sites) {
      if (site.kind === 'namespace')
        throw path.buildCodeFrameError('memo-dom: namespaced JSX tags are not supported');
      const { element, selector, candidates } = site;
      for (const candidate of candidates) {
        if (candidate.kind === 'intrinsic' && !/^[A-Za-z][A-Za-z0-9:_-]*$/.test(candidate.name)) {
          throw path.buildCodeFrameError(
            `memo-dom: '${candidate.name}' is not a valid dynamic intrinsic tag name`,
          );
        }
      }
      const replacement =
        candidates.length === 1
          ? cloneWithTag(element, astFactory.jsxIdentifier(candidates[0]!.name))
          : astFactory.jsxFragment(
              astFactory.jsxOpeningFragment(),
              astFactory.jsxClosingFragment(),
              [
                astFactory.jsxExpressionContainer(
                  finiteSelection(scratch(), selector, element, candidates),
                ),
              ],
            );
      replaceNode(
        ctx.astAnalysis!,
        element as unknown as BaseNode,
        replacement as unknown as BaseNode,
      );
    }
    if (hasJsx) refreshAstAnalysis(ctx, program);
  }
}

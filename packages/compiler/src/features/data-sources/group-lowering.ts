/**
 * JSX Group lowering and transparent policy orchestration.
 *
 * The public binding is typed as ResolvedValue<T>, while generated code keeps
 * the library's source holder. Reads are lowered either to a render gate or an
 * imperative resolution guard; source transitions push the owning component
 * through the ordinary runtime dirty queue.
 */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { cloneNode as cloneEstreeNode } from '../../ast';
import {
  refreshAstAnalysis,
  type Ctx,
  type TransparentPresentationComponent,
} from '../../context';
import {
  childNode,
  replaceNode,
  walkAst,
  type BaseNode,
} from '../../ast';
import { mdd } from '../../identifiers';
import {
  annotateGroupComponentCalls,
  expressionOrigins,
  groupOrigins,
  inferredGroupDataNames,
  isLoweredGroupExpression,
  jsxTagName,
} from './group-analysis';
import { componentPolicy } from './group-policy-components';
import {
  annotateTransparentSources,
  sourceArray,
} from './subscriptions';
import {
  consumeSuspendDirective,
  suspendDirective,
} from './suspend-directive';
import {
  lowerTsrxTryBoundary,
  tsrxTryMetadata,
} from './tsrx-boundaries';

function meaningfulGroupChildren(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): Array<t.JSXElement | t.JSXFragment | t.JSXExpressionContainer> {
  return element.children.filter((child): child is
    t.JSXElement | t.JSXFragment | t.JSXExpressionContainer => {
    if (astFactory.isJSXText(child)) {
      if (child.value.trim() !== '') {
        throw errorAt.buildCodeFrameError(
          'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
          child,
        );
      }
      return false;
    }
    if (
      astFactory.isJSXExpressionContainer(child) &&
      astFactory.isJSXEmptyExpression(child.expression)
    ) {
      return false;
    }
    return astFactory.isJSXElement(child) ||
      astFactory.isJSXFragment(child) ||
      astFactory.isJSXExpressionContainer(child);
  });
}

function policyElement(name: string, attributes: t.JSXAttribute[]): t.JSXElement {
  return astFactory.jsxElement(
    astFactory.jsxOpeningElement(astFactory.jsxIdentifier(name), attributes, true),
    null,
    [],
  );
}

function groupPolicyElement(
  policy: string | TransparentPresentationComponent,
  attributes: t.JSXAttribute[],
): t.JSXElement {
  if (typeof policy === 'string') return policyElement(policy, attributes);
  return policyElement(policy.component, [
    ...attributes,
    ...policy.props.map(({ name, value }) =>
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier(name),
        astFactory.jsxExpressionContainer(cloneEstreeNode(value, true)),
      )
    ),
  ]);
}

function wrapGroupSite(
  ctx: Ctx,
  expression: t.Expression,
  dependencies: readonly string[],
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): void {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const committed = astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(cloneEstreeNode(expression, true))],
  );
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    groupPolicyElement(error, [
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('error'),
        astFactory.jsxExpressionContainer(errorRead()),
      ),
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('retry'),
        astFactory.jsxExpressionContainer(retry),
      ),
    ]),
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      groupPolicyElement(pending, []),
      committed,
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  replaceNode(
    ctx.astAnalysis!,
    expression as unknown as BaseNode,
    conditional as unknown as BaseNode,
  );
}

function suspendedGroupOutput(
  ctx: Ctx,
  content: t.JSXElement,
  dependencies: readonly string[],
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): t.JSXFragment {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const retry = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const committed = astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [cloneEstreeNode(content, true)],
  );
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    groupPolicyElement(error, [
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('error'),
        astFactory.jsxExpressionContainer(errorRead()),
      ),
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('retry'),
        astFactory.jsxExpressionContainer(retry),
      ),
    ]),
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      groupPolicyElement(pending, []),
      committed,
    ),
  );
  (conditional as t.ConditionalExpression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup = true;
  annotateTransparentSources(conditional, dependencies);
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    [astFactory.jsxExpressionContainer(conditional)],
  );
}

/** Normalize the exact three-child Group form into independent local sites. */
export function lowerTransparentGroups(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): void {
  const generatedPolicies: t.FunctionDeclaration[] = [];
  refreshAstAnalysis(ctx, programPath.node);
  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    leave(node) {
        const tryMetadata = tsrxTryMetadata(node);
        if (tryMetadata !== null) {
          replaceNode(
            ctx.astAnalysis!,
            node,
            lowerTsrxTryBoundary(
              ctx,
              node,
              tryMetadata,
              generatedPolicies,
              programPath,
            ),
          );
          return;
        }
        if (node.type !== 'JSXElement') return;
        const element = node as unknown as t.JSXElement;
        const tag = jsxTagName(element);
        if (tag === null || !ctx.transparentGroups.has(tag)) return;
        const children = meaningfulGroupChildren(element, programPath);
        if (children.length !== 3) {
          throw programPath.buildCodeFrameError(
            'memo-dom: Group requires exactly three direct children: Pending, Error, and one content child',
            element,
          );
        }
        const [pendingElement, errorElement, content] = children;
        if (!astFactory.isJSXElement(pendingElement) || !astFactory.isJSXElement(errorElement)) {
          throw programPath.buildCodeFrameError(
            'memo-dom: Group children one and two must be Pending and Error declarations',
            element,
          );
        }
        const pending = componentPolicy(
          ctx,
          pendingElement,
          ctx.transparentPendingPolicies,
          'Pending',
          'pending',
          generatedPolicies,
          programPath,
        );
        const error = componentPolicy(
          ctx,
          errorElement,
          ctx.transparentErrorPolicies,
          'Error',
          'error',
          generatedPolicies,
          programPath,
        );
        const contentSuspend = astFactory.isJSXElement(content)
          ? suspendDirective(content, programPath)
          : null;
        const data = inferredGroupDataNames(
          ctx,
          element,
          content as unknown as BaseNode,
          programPath,
        );
        const origins = groupOrigins(
          ctx,
          node,
          data,
        );
        if (astFactory.isJSXElement(content)) {
          if (contentSuspend !== null) {
            if (data.length === 0) {
              throw programPath.buildCodeFrameError(
                'memo-dom: suspended Group content must read colorless sources in the current component; descendant-owned sources can use this Group only in colorless mode',
                contentSuspend,
              );
            }
            consumeSuspendDirective(content, contentSuspend);
            replaceNode(
              ctx.astAnalysis!,
              node,
              suspendedGroupOutput(
                ctx,
                content,
                data,
                pending,
                error,
              ) as unknown as BaseNode,
            );
            ctx.usesTransparentData = true;
            return;
          }
        }
        annotateGroupComponentCalls(
          ctx,
          content as unknown as BaseNode,
          origins,
          pending,
          error,
        );
        walkAst(content as unknown as BaseNode, {
          enter(current) {
            if (current.type !== 'JSXExpressionContainer') return;
            const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
            if (parent?.type === 'JSXAttribute') return false;
            const expression = childNode(current, 'expression');
            if (
              expression === null ||
              !astFactory.isExpression(expression as unknown as t.Node)
            ) return false;
            const authoredExpression = expression as unknown as t.Expression;
            if (isLoweredGroupExpression(authoredExpression)) return false;
            const used = expressionOrigins(ctx, expression, origins);
            if (used.size === 0) return undefined;
            wrapGroupSite(ctx, authoredExpression, [...used], pending, error);
            return false;
          },
        });
        ctx.usesTransparentData = true;
        // Move the authored content node so Group's internal lowering markers
        // survive into the later transparent-read pass.
        replaceNode(
          ctx.astAnalysis!,
          node,
          content as unknown as BaseNode,
        );
    },
  });
  programPath.node.body.push(...generatedPolicies);
  refreshAstAnalysis(ctx, programPath.node);
  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type !== 'JSXElement') return;
      const element = node as unknown as t.JSXElement;
      const tag = jsxTagName(element);
      if (tag === null || !/^[A-Z]/.test(tag)) return;
      if (suspendDirective(element, programPath) === null) return;
      throw programPath.buildCodeFrameError(
        'memo-dom: suspend requires the element to be the direct content child of Group',
        element,
      );
    },
  });
}

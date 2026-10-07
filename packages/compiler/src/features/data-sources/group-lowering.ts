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
import { refreshAstAnalysis, nodeHasJsx, type TransparentPresentationPolicy } from '../../context';
import { type DomContext as Ctx } from '../../dom/context';
import {
  childNode,
  replaceNode,
  walkAst,
  type BaseNode,
} from '../../ast';
import { generatedIdentifier } from '../../dom/identifiers';
import { wrapAutomaticSite } from './automatic-sites';
import { atomicSite, markAtomicRoute } from './atomic-sites';
import {
  annotateGroupComponentCalls,
  expressionOrigins,
  groupOrigins,
  inferredGroupDataNames,
  isLoweredGroupExpression,
  jsxTagName,
} from './group-analysis';
import { emitPresentationComponent } from './group-policy-components';
import type {GroupPresentationPlan} from '../../planning/presentation-policy';
import {
  consumeSuspendDirective,
  suspendDirective,
} from './suspend-directive';
import {
  lowerTsrxTryBoundary,
  tsrxTryMetadata,
} from './tsrx-boundaries';

/** Erase Group scopes and lower source reads under their nearest policies. */
function lowerGroupScopes(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
  generatedPolicies: t.FunctionDeclaration[],
  presentations:ReadonlyMap<t.JSXElement,GroupPresentationPlan>,
): void {
  const scopes: TransparentPresentationPolicy[] = [];
  const plans = new WeakMap<t.JSXElement, TransparentPresentationPolicy>();
  const ownerOf = (node: BaseNode): string => {
    let parent = ctx.astAnalysis?.parentByNode.get(node);
    while (parent !== undefined && parent !== null) {
      if (parent.type === 'FunctionDeclaration') {
        const owner = parent as unknown as t.FunctionDeclaration;
        if (owner.id !== null) return owner.id.name;
      }
      parent = ctx.astAnalysis?.parentByNode.get(parent);
    }
    throw programPath.buildCodeFrameError('memo-dom: Group must be authored inside a component', node as unknown as t.Node);
  };
  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type !== 'JSXElement') return;
      const element = node as unknown as t.JSXElement;
      const tag = jsxTagName(element);
      if (tag === null || !ctx.transparentGroups.has(tag)) return;
      const presentation=presentations.get(element);
      if(presentation===undefined)throw new Error('memo-dom: missing authored Group presentation plan');
      const pending=presentation.pending===undefined?undefined:emitPresentationComponent(ctx,presentation.pending,'pending',generatedPolicies);
      const error=presentation.error===undefined?undefined:emitPresentationComponent(ctx,presentation.error,'error',generatedPolicies);
      const policy = {
        ...scopes.at(-1),
        ...(pending === undefined ? {} : { pending }),
        ...(error === undefined ? {} : { error }),
      };
      plans.set(element, policy);
      scopes.push(policy);
    },
    leave(node) {
      if (node.type !== 'JSXElement') return;
      const element = node as unknown as t.JSXElement;
      const tag = jsxTagName(element);
      if (tag === null) return;
      if (!ctx.transparentGroups.has(tag)) {
        const directive = suspendDirective(element, programPath);
        if (directive === null) return;
        // TSRX owns its output gate; do not consume its directive before the
        // @try lowering pass validates and lowers that boundary.
        let ancestor = ctx.astAnalysis?.parentByNode.get(node);
        while (ancestor !== undefined && ancestor !== null) {
          if (tsrxTryMetadata(ancestor) !== null) return;
          ancestor = ctx.astAnalysis?.parentByNode.get(ancestor);
        }
        const owner = ownerOf(node);
        if (!ctx.transparentPolicyParams.has(owner)) {
          ctx.transparentPolicyParams.set(owner, generatedIdentifier(ctx, 'dataPolicies'));
        }
        consumeSuspendDirective(element, directive);
        // Route metadata is collected after data lowering. Preserve this
        // element until route emission can put suspension inside the match.
        if (element.openingElement.attributes.some(attribute =>
          astFactory.isJSXAttribute(attribute) &&
          astFactory.isJSXIdentifier(attribute.name, { name: 'route' }))) {
          markAtomicRoute(element, scopes.at(-1));
          return;
        }
        replaceNode(ctx.astAnalysis!, node, atomicSite(element, scopes.at(-1)) as unknown as BaseNode);
        return;
      }
      scopes.pop();
      const policy = plans.get(element)!;
      const owner = ownerOf(node);
      if (!ctx.transparentPolicyParams.has(owner)) {
        ctx.transparentPolicyParams.set(owner, generatedIdentifier(ctx, 'dataPolicies'));
      }
      const content = astFactory.jsxFragment(astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), element.children);
      const data = inferredGroupDataNames(ctx, element, content as unknown as BaseNode);
      const origins = groupOrigins(ctx, node, data);
      annotateGroupComponentCalls(ctx, content as unknown as BaseNode, origins, policy.pending, policy.error);
      walkAst(content as unknown as BaseNode, {
        enter(current) {
          if (current.type !== 'JSXExpressionContainer') return;
          const parent = ctx.astAnalysis?.parentByNode.get(current);
          if (parent?.type === 'JSXAttribute') return false;
          const expression = childNode(current, 'expression');
          if (expression === null || !astFactory.isExpression(expression as unknown as t.Node)) return false;
          if (isLoweredGroupExpression(expression as unknown as t.Expression)) return false;
          const value = expression as unknown as t.Expression;
          const selector = astFactory.isConditionalExpression(value) ? value.test
            : astFactory.isLogicalExpression(value) ? value.left : null;
          if (selector !== null && nodeHasJsx(value) &&
            expressionOrigins(ctx, selector as unknown as BaseNode, origins).size === 0) {
            // The selector itself is available. Keep inactive branch sources
            // out of readiness and apply Group policy at the active sinks.
            return undefined;
          }
          const dependencies = [...expressionOrigins(ctx, expression, origins)];
          if (dependencies.length === 0) return;
          wrapAutomaticSite(ctx, owner, expression as unknown as t.Expression, dependencies, policy);
          return false;
        },
      });
      ctx.usesTransparentData = true;
      replaceNode(ctx.astAnalysis!, node, (presentations.get(element)!.suspend ? atomicSite(content, policy) : content) as unknown as BaseNode);
    },
  });
  refreshAstAnalysis(ctx, programPath.node);
}

/** Lower Group scopes and TSRX boundaries into independent local sites. */
export function lowerTransparentGroups(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
  presentations:ReadonlyMap<t.JSXElement,GroupPresentationPlan>,
): void {
  const generatedPolicies: t.FunctionDeclaration[] = [];
  lowerGroupScopes(ctx, programPath, generatedPolicies,presentations);
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
        'memo-dom: suspend could not be assigned to a component-owned render boundary',
        element,
      );
    },
  });
}

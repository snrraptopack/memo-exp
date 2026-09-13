/** Lowering for TSRX @try, @pending, and @catch boundaries. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  nodeFields as fields,
  type BaseNode,
  type Identifier as AstIdentifier,
} from '../../ast';
import type {
  Ctx,
  TransparentPresentationComponent,
  TransparentPresentationPolicy,
} from '../../context';
import {
  generatedComponentIdentifier,
  generatedIdentifier,
  mdd,
} from '../../identifiers';
import {
  componentSourceProps,
  jsxTagName,
  type ComponentSourceProp,
} from './group-analysis';
import {
  objectBindingPattern,
  policyCaptures,
} from './group-policy-components';
import {
  annotateTransparentSources,
  sourceArray,
} from './subscriptions';
import {
  consumeSuspendDirective,
  suspendDirective,
} from './suspend-directive';

export interface TsrxTryHandlerMetadata {
  param: BaseNode | null;
  resetParam: BaseNode | null;
  output: BaseNode;
}

export interface TsrxTryMetadata {
  pending: BaseNode | null;
  handler: TsrxTryHandlerMetadata | null;
}

export function tsrxTryMetadata(node: BaseNode): TsrxTryMetadata | null {
  const value = fields(node).__memoDomTsrxTry;
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pending = record.pending;
  const handler = record.handler;
  if (pending !== null && !astFactory.isNode(pending)) return null;
  if (handler !== null && (typeof handler !== 'object')) return null;
  if (handler === null) return { pending: pending as BaseNode | null, handler: null };
  const handlerRecord = handler as Record<string, unknown>;
  if (!astFactory.isNode(handlerRecord.output)) return null;
  return {
    pending: pending as BaseNode | null,
    handler: {
      param: astFactory.isNode(handlerRecord.param)
        ? handlerRecord.param as BaseNode
        : null,
      resetParam: astFactory.isNode(handlerRecord.resetParam)
        ? handlerRecord.resetParam as BaseNode
        : null,
      output: handlerRecord.output as BaseNode,
    },
  };
}

function renderOutputFragment(output: BaseNode): t.JSXFragment {
  const child = cloneEstreeNode(output, true) as unknown as t.Expression;
  return astFactory.jsxFragment(
    astFactory.jsxOpeningFragment(),
    astFactory.jsxClosingFragment(),
    astFactory.isJSXElement(child) || astFactory.isJSXFragment(child)
      ? [child]
      : [astFactory.jsxExpressionContainer(child)],
  );
}

function handlerOutput(
  metadata: TsrxTryHandlerMetadata,
  error: t.Expression,
  reset: t.Expression,
  programPath: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXFragment {
  const params: t.Identifier[] = [];
  const args: t.Expression[] = [];
  if (metadata.param !== null) {
    if (!astFactory.isIdentifier(metadata.param as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier error parameter',
        metadata.param as unknown as t.Node,
      );
    }
    params.push(cloneEstreeNode(metadata.param as unknown as t.Identifier));
    args.push(cloneEstreeNode(error));
  }
  if (metadata.resetParam !== null) {
    if (!astFactory.isIdentifier(metadata.resetParam as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier reset parameter',
        metadata.resetParam as unknown as t.Node,
      );
    }
    params.push(cloneEstreeNode(metadata.resetParam as unknown as t.Identifier));
    args.push(cloneEstreeNode(reset));
  }
  const output = cloneEstreeNode(metadata.output, true) as unknown as t.Expression;
  const call = astFactory.callExpression(
    astFactory.arrowFunctionExpression(params, output),
    args,
  );
  return renderOutputFragment(call as unknown as BaseNode);
}

function suspendedTsrxTryOutput(
  ctx: Ctx,
  component: t.JSXElement,
  dependencies: readonly string[],
  metadata: TsrxTryMetadata,
  programPath: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXFragment {
  const sources = sourceArray(dependencies);
  const errorRead = (): t.CallExpression =>
    astFactory.callExpression(mdd(ctx, 'resolvedValuesError'), [
      cloneEstreeNode(sources, true),
    ]);
  const reset = astFactory.arrowFunctionExpression(
    [],
    astFactory.callExpression(mdd(ctx, 'retryResolvedValues'), [
      cloneEstreeNode(sources, true),
    ]),
  );
  const errorOutput = metadata.handler === null
    ? renderOutputFragment(
        astFactory.callExpression(mdd(ctx, 'throwResolvedValuesError'), [
          cloneEstreeNode(sources, true),
        ]) as unknown as BaseNode,
      )
    : handlerOutput(
        metadata.handler,
        errorRead(),
        reset,
        programPath,
      );
  const pendingOutput = metadata.pending === null
    ? astFactory.jsxFragment(
        astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(),
        [],
      )
    : renderOutputFragment(metadata.pending);
  const conditional = astFactory.conditionalExpression(
    errorRead(),
    errorOutput,
    astFactory.conditionalExpression(
      astFactory.callExpression(mdd(ctx, 'resolvedValuesPending'), [
        cloneEstreeNode(sources, true),
      ]),
      pendingOutput,
      renderOutputFragment(component as unknown as BaseNode),
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

function tsrxPolicyComponent(
  ctx: Ctx,
  boundary: BaseNode,
  output: BaseNode,
  kind: 'pending' | 'error',
  handler: TsrxTryHandlerMetadata | null,
): {
  declaration: t.FunctionDeclaration;
  renderer: TransparentPresentationComponent;
} {
  const excluded = new Set<string>();
  if (
    handler?.param !== null &&
    handler?.param !== undefined &&
    handler.param.type === 'Identifier'
  ) {
    excluded.add((handler.param as unknown as AstIdentifier).name);
  }
  if (
    handler?.resetParam !== null &&
    handler?.resetParam !== undefined &&
    handler.resetParam.type === 'Identifier'
  ) {
    excluded.add((handler.resetParam as unknown as AstIdentifier).name);
  }
  const captures = policyCaptures(ctx, boundary, output, excluded);
  const params: Array<{ prop: string; local: t.Identifier }> = [];
  if (kind === 'error') {
    const error = handler?.param === null || handler?.param === undefined
      ? generatedIdentifier(ctx, 'tsrxError')
      : cloneEstreeNode(handler.param as unknown as t.Identifier);
    const retry = handler?.resetParam === null || handler?.resetParam === undefined
      ? generatedIdentifier(ctx, 'tsrxReset')
      : cloneEstreeNode(handler.resetParam as unknown as t.Identifier);
    params.push({ prop: 'error', local: error });
    params.push({ prop: 'retry', local: retry });
  }
  for (const capture of captures) {
    params.push({
      prop: capture.prop,
      local: astFactory.identifier(capture.binding.name),
    });
  }
  const name = generatedComponentIdentifier(
    ctx,
    kind === 'pending' ? 'TsrxPending' : 'TsrxCatch',
  );
  const declaration = astFactory.functionDeclaration(
    cloneEstreeNode(name),
    params.length === 0 ? [] : [objectBindingPattern(params)],
    astFactory.blockStatement([
      astFactory.returnStatement(
        cloneEstreeNode(output, true) as unknown as t.Expression,
      ),
    ]),
  );
  return {
    declaration,
    renderer: {
      component: name.name,
      props: captures.map((capture) => ({
        name: capture.prop,
        value: astFactory.identifier(capture.binding.name),
      })),
    },
  };
}

function attachTsrxColorlessPolicy(
  ctx: Ctx,
  component: t.JSXElement,
  sourceProps: readonly ComponentSourceProp[],
  policy: TransparentPresentationPolicy,
): void {
  const policies = ctx.transparentGroupCallPolicies.get(component) ?? new Map();
  for (const { prop } of sourceProps) policies.set(prop, policy);
  ctx.transparentGroupCallPolicies.set(component, policies);
}

export function lowerTsrxTryBoundary(
  ctx: Ctx,
  node: BaseNode,
  metadata: TsrxTryMetadata,
  generatedPolicies: t.FunctionDeclaration[],
  programPath: {
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): BaseNode {
  if (node.type !== 'JSXFragment') return node;
  const children = (node as unknown as t.JSXFragment).children.filter(
    (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
  );
  if (children.length !== 1 || !astFactory.isJSXElement(children[0])) {
    throw programPath.buildCodeFrameError(
      'memo-dom: TSRX @try currently requires one direct component output',
      node as unknown as t.Node,
    );
  }
  const component = children[0];
  const tag = jsxTagName(component);
  if (tag === null || !/^[A-Z]/.test(tag)) {
    throw programPath.buildCodeFrameError(
      'memo-dom: TSRX @try currently requires one direct component output',
      component,
    );
  }
  const suspend = suspendDirective(component, programPath);
  const sourceProps = componentSourceProps(ctx, component);
  const dependencies = [...new Set(sourceProps.map(({ source }) => source))];
  if (sourceProps.length === 0) {
    throw programPath.buildCodeFrameError(
      `memo-dom: TSRX @try component <${tag}> requires at least one direct colorless-source prop`,
      component,
    );
  }
  ctx.usesTransparentData = true;
  if (suspend === null) {
    if (metadata.handler === null) {
      throw programPath.buildCodeFrameError(
        'memo-dom: unsuspended TSRX @try requires @catch so colorless source failures have a local policy',
        node as unknown as t.Node,
      );
    }
    if (!astFactory.isIdentifier(metadata.handler.param as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier error parameter',
        metadata.handler.param as unknown as t.Node,
      );
    }
    if (!astFactory.isIdentifier(metadata.handler.resetParam as unknown as t.Node)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: TSRX @catch currently requires an identifier reset parameter',
        metadata.handler.resetParam as unknown as t.Node,
      );
    }
    const pendingOutput = metadata.pending ?? astFactory.jsxFragment(
      astFactory.jsxOpeningFragment(),
      astFactory.jsxClosingFragment(),
      [],
    ) as unknown as BaseNode;
    const pending = tsrxPolicyComponent(
      ctx,
      node,
      pendingOutput,
      'pending',
      null,
    );
    const error = tsrxPolicyComponent(
      ctx,
      node,
      metadata.handler.output,
      'error',
      metadata.handler,
    );
    generatedPolicies.push(pending.declaration, error.declaration);
    attachTsrxColorlessPolicy(ctx, component, sourceProps, {
      pending: pending.renderer,
      error: error.renderer,
    });
    return component as unknown as BaseNode;
  }
  consumeSuspendDirective(component, suspend);
  return suspendedTsrxTryOutput(
    ctx,
    component,
    dependencies,
    metadata,
    programPath,
  ) as unknown as BaseNode;
}

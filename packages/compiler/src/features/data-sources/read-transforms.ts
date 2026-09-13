/** AST transformations used by transparent-source read rewriting. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import { astBindingAt, type Ctx } from '../../context';
import { generatedIdentifier, mdd } from '../../identifiers';
import {
  isBoundTo,
  isEventSourceHolderReference,
  isPassthroughArgument,
  sourceDependencies,
  type TransparentDerivation,
} from './read-analysis';
import { sourceArray, type RenderGatedExpression } from './subscriptions';

export function replaceDerivedReads(
  ctx: Ctx,
  root: BaseNode,
  derived: ReadonlyMap<string, TransparentDerivation>,
): void {
  const found: Array<{ identifier: BaseNode; expression: t.Expression }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const projection = derived.get(name);
      if (
        projection === undefined ||
        !isBoundTo(ctx, node, projection.binding)
      ) return;
      found.push({ identifier: node, expression: projection.expression });
      return false;
    },
  });
  for (const { identifier, expression } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(expression, true) as unknown as BaseNode,
    );
  }
}

export function trackDependencies(
  ctx: Ctx,
  root: BaseNode,
  tracks: ReadonlyMap<string, readonly string[]>,
  bindings: ReadonlyMap<string, AstBinding>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const sources = tracks.get(name);
    if (sources === undefined) return;
    const binding = astBindingAt(ctx, root, name);
    if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
    for (const source of sources) found.add(source);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') {
        note(node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const call = node as unknown as t.CallExpression;
      if (
        !astFactory.isIdentifier(call.callee) ||
        !ctx.transparentTrackFactories.has(call.callee.name) ||
        astBindingAt(ctx, node, call.callee.name)?.kind !== 'import'
      ) return;
      const argument = call.arguments[0];
      if (!astFactory.isIdentifier(argument)) return;
      const binding = bindings.get(argument.name);
      if (
        binding !== undefined &&
        isBoundTo(ctx, argument as unknown as BaseNode, binding)
      ) found.add(argument.name);
    },
  });
  return [...found].sort();
}

function replaceSourceReads(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  replacements: ReadonlyMap<string, t.Identifier>,
  eventSources: ReadonlySet<string>,
): void {
  const found: Array<{ identifier: BaseNode; replacement: t.Identifier }> = [];
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as AstIdentifier).name;
      const binding = bindings.get(name);
      const replacement = replacements.get(name);
      if (
        binding === undefined ||
        replacement === undefined ||
        !isBoundTo(ctx, node, binding) ||
        isPassthroughArgument(ctx, node) ||
        isEventSourceHolderReference(ctx, node, eventSources)
      ) {
        return;
      }
      found.push({ identifier: node, replacement });
      return false;
    },
  });
  for (const { identifier, replacement } of found) {
    overwriteNode(
      identifier,
      cloneEstreeNode(replacement) as unknown as BaseNode,
    );
  }
}

/**
 * Render-site semantics for authored control flow: source reads become
 * render-gated (unavailable renders empty, initial failure stays loud) so
 * state-driven branches evaluate immediately while payload sinks self-gate.
 */
export function replaceSourceReadsWithRenderGates(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
): void {
  // Collect first, replace after — the replacement call embeds the same
  // identifier, so replacing during traversal would recurse forever.
  const found: BaseNode[] = [];
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
    if (isPassthroughArgument(ctx, identifier)) return;
    if (isEventSourceHolderReference(ctx, identifier, eventSources)) return;
    found.push(identifier);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  for (const identifier of found) {
    const name = (identifier as unknown as AstIdentifier).name;
    overwriteNode(
      identifier,
      astFactory.callExpression(
        mdd(ctx, 'readResolvedValueForRender'),
        [astFactory.identifier(name)],
      ) as unknown as BaseNode,
    );
  }
}

/**
 * A read inside a render-gated subtree is already availability-safe — unless
 * it sits inside a nested function (handler/effect), where the imperative R2
 * guard still applies.
 */
export function isInsideRenderGate(ctx: Ctx, identifier: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (current !== null) {
    if (
      (current as unknown as RenderGatedExpression).__memoDomRenderGated === true
    ) {
      return true;
    }
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression' ||
      current.type === 'FunctionDeclaration'
    ) return false;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

export function resolvedRenderExpression(
  ctx: Ctx,
  expression: t.Expression,
  dependencies: readonly string[],
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
  helper = 'readResolvedValuesForRender',
): t.Expression {
  const replacements = new Map<string, t.Identifier>();
  const parameters = dependencies.map((source) => {
    const parameter = generatedIdentifier(ctx, `${source}Value`);
    replacements.set(source, parameter);
    return cloneEstreeNode(parameter);
  });
  replaceSourceReads(
    ctx,
    expression as unknown as BaseNode,
    bindings,
    replacements,
    eventSources,
  );
  const callback = astFactory.arrowFunctionExpression(
    parameters,
    cloneEstreeNode(expression, true),
  );
  ctx.compilerOwnedCallbacks.add(callback);
  return astFactory.callExpression(mdd(ctx, helper), [
    astFactory.arrayExpression(
      dependencies.map((source) => astFactory.identifier(source)),
    ),
    callback,
  ]);
}

/**
 * Gate an effect that consumes an event-created colorless value. The holder
 * is absent before the first event and pending immediately after assignment;
 * the slot invalidates the owner again when it settles, at which point the
 * authored callback runs with honest payloads and may return its cleanup.
 */
export function gateEventSourceEffects(
  ctx: Ctx,
  component: string,
  bindings: ReadonlyMap<string, AstBinding>,
  eventSources: ReadonlySet<string>,
): void {
  if (eventSources.size === 0) return;
  const emptyDerived = new Map<string, TransparentDerivation>();
  for (const site of ctx.effects.get(component) ?? []) {
    const callback = site.callback;
    if (
      !astFactory.isArrowFunctionExpression(callback) &&
      !astFactory.isFunctionExpression(callback)
    ) continue;
    const dependencies = sourceDependencies(
      ctx,
      callback as unknown as BaseNode,
      bindings,
      emptyDerived,
      eventSources,
    );
    if (!dependencies.some(source => eventSources.has(source))) continue;

    const replacements = new Map<string, t.Identifier>();
    const parameters = dependencies.map(source => {
      const parameter = generatedIdentifier(ctx, `${source}EffectValue`);
      replacements.set(source, parameter);
      return cloneEstreeNode(parameter);
    });
    replaceSourceReads(
      ctx,
      callback.body as unknown as BaseNode,
      bindings,
      replacements,
      eventSources,
    );
    const run = astFactory.arrowFunctionExpression(
      parameters,
      cloneEstreeNode(callback.body, true),
    );
    ctx.compilerOwnedCallbacks.add(run);
    const gated = astFactory.arrowFunctionExpression(
      [],
      astFactory.callExpression(mdd(ctx, 'runResolvedValuesEffect'), [
        sourceArray(dependencies),
        run,
      ]),
    );
    ctx.compilerOwnedCallbacks.add(gated);
    site.callback = gated;
  }
}

import {
  asNode as node,
  nodeFields as fields,
  walkAst,
  type BaseNode,
} from '../ast';
import type { Ctx } from '../context';

function jsxIdentifierName(value: unknown): string | null {
  const identifier = node(value);
  if (identifier?.type !== 'JSXIdentifier') return null;
  const name = fields(identifier).name;
  return typeof name === 'string' ? name : null;
}

function jsxAttributeName(value: unknown): string | null {
  const name = node(value);
  if (name?.type === 'JSXIdentifier') return jsxIdentifierName(name);
  if (name?.type !== 'JSXNamespacedName') return null;
  const namespace = jsxIdentifierName(fields(name).namespace);
  const local = jsxIdentifierName(fields(name).name);
  return namespace === null || local === null ? null : `${namespace}:${local}`;
}

/** Module dependencies read anywhere in an already-analyzed component tree. */
export function componentSubtreeReads(
  ctx: Ctx,
  componentName: string,
  visiting: Set<string> = new Set(),
): Set<string> {
  const imported = ctx.importedComponents.get(componentName);
  if (imported !== undefined) {
    return new Set(imported.subtreeReads ?? []);
  }
  if (visiting.has(componentName)) return new Set();
  visiting.add(componentName);
  const reads = new Set(ctx.compReads.get(componentName) ?? []);
  for (const effect of ctx.effects.get(componentName) ?? []) {
    for (const read of effect.moduleReads) reads.add(read);
    for (const read of effect.conditionModuleReads) reads.add(read);
  }
  const path = ctx.compPaths.get(componentName);
  if (path !== undefined) {
    walkAst<BaseNode>(path.node, {
      enter(current) {
        if (current.type !== 'JSXElement') return;
        const opening = node(fields(current).openingElement);
        const name =
          opening === null ? null : jsxIdentifierName(fields(opening).name);
        if (name === null || !/^[A-Z]/.test(name)) return;
        for (const read of componentSubtreeReads(ctx, name, visiting)) {
          reads.add(read);
        }
      },
    });
  }
  visiting.delete(componentName);
  return reads;
}

/**
 * Render-callback component trees live under callee-owned row identities, but
 * their dependencies and refresh manager remain caller-owned. Fold those
 * static dependencies into the caller access-table entry.
 */
export function foldRenderCallbackSubtreeReads(ctx: Ctx): void {
  for (const [caller, callerPath] of ctx.compPaths) {
    const callerReads = ctx.compReads.get(caller);
    if (callerReads === undefined) continue;
    walkAst<BaseNode>(callerPath.node, {
      enter(current, parent) {
        if (
          current.type !== 'JSXAttribute' ||
          parent?.type !== 'JSXOpeningElement'
        ) {
          return;
        }
        const targetName = jsxIdentifierName(fields(parent).name);
        if (targetName === null) return;
        const propName = jsxAttributeName(fields(current).name);
        if (propName === null) return;
        if (
          ctx.componentProps
            .get(targetName)
            ?.renderCallbacks.includes(propName) !== true
        ) {
          return;
        }
        const value = node(fields(current).value);
        if (value?.type !== 'JSXExpressionContainer') return;
        const expression = node(fields(value).expression);
        if (expression === null || expression.type === 'JSXEmptyExpression') return;
        walkAst<BaseNode>(expression, {
          enter(descendant) {
            if (descendant.type !== 'JSXOpeningElement') return;
            const name = jsxIdentifierName(fields(descendant).name);
            if (name !== null && /^[A-Z]/.test(name)) {
            for (const read of componentSubtreeReads(
              ctx,
                name,
            )) {
              callerReads.add(read);
            }
          }
          },
        });
      },
    });
  }
}

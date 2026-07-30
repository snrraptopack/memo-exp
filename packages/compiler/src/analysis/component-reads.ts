import * as t from '@babel/types';
import { walkNodes, type Ctx } from '../context';
import { jsxAttributeName } from '../jsx/attributes';

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
    path.traverse({
      JSXElement(element) {
        const name = element.node.openingElement.name;
        if (!t.isJSXIdentifier(name) || !/^[A-Z]/.test(name.name)) return;
        for (const read of componentSubtreeReads(ctx, name.name, visiting)) {
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
    callerPath.traverse({
      JSXAttribute(attribute) {
        const opening = attribute.parentPath;
        if (!opening?.isJSXOpeningElement()) return;
        const targetName = opening.node.name;
        if (!t.isJSXIdentifier(targetName)) return;
        const propName = jsxAttributeName(attribute.node.name);
        if (
          ctx.componentProps
            .get(targetName.name)
            ?.renderCallbacks.includes(propName) !== true
        ) {
          return;
        }
        const value = attribute.node.value;
        if (
          !t.isJSXExpressionContainer(value) ||
          !t.isExpression(value.expression)
        ) {
          return;
        }
        walkNodes(value.expression, (node) => {
          if (
            t.isJSXOpeningElement(node) &&
            t.isJSXIdentifier(node.name) &&
            /^[A-Z]/.test(node.name.name)
          ) {
            for (const read of componentSubtreeReads(
              ctx,
              node.name.name,
            )) {
              callerReads.add(read);
            }
          }
        });
      },
    });
  }
}

import {
  asNode as node,
  jsxIdentifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
} from '../ast';
import { astBindingAt, type Ctx } from '../context';
import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { sourceAttributeValues } from '../jsx/attributes';
import { storeReadKey } from './read-collection';
import { summarizeHelper } from '../helper-summaries';

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
      enter(current) {
        if (current.type !== 'JSXOpeningElement') return;
        const opening = current as t.JSXOpeningElement;
        if (!b.isJSXIdentifier(opening.name)) return;
        const target = ctx.componentProps.get(opening.name.name);

        for (const attribute of sourceAttributeValues(opening.attributes)) {
          if (!target?.renderCallbacks.includes(attribute.name)) continue;
          walkAst<t.Node>(attribute.value, {
            enter(descendant, parent) {
              // Event/ref callbacks are not render reads. Ordinary nested map
              // calculations still participate, with lexical binding checks.
              if (
                b.isJSXAttribute(descendant) &&
                b.isJSXIdentifier(descendant.name) &&
                (descendant.name.name === 'ref' || /^on[A-Z]/.test(descendant.name.name))
              ) {
                return false;
              }

              if (
                b.isIdentifier(descendant) &&
                ctx.state.has(descendant.name) &&
                astBindingAt(ctx, descendant, descendant.name)?.scope.isProgramScope === true
              ) {
                const memberProperty =
                  (b.isMemberExpression(parent) || b.isOptionalMemberExpression(parent)) &&
                  parent.property === descendant && !parent.computed;
                const objectKey =
                  b.isObjectProperty(parent) && parent.key === descendant &&
                  !parent.computed && !parent.shorthand;
                const writeTarget =
                  b.isAssignmentExpression(parent) && parent.operator === '=' &&
                  parent.left === descendant;

                if (!memberProperty && !objectKey && !writeTarget) {
                  callerReads.add(descendant.name);
                }
              }

              if (b.isMemberExpression(descendant)) {
                const key = storeReadKey(ctx, descendant);
                if (key !== null) callerReads.add(key);
              }

              if (
                (b.isCallExpression(descendant) || b.isOptionalCallExpression(descendant)) &&
                b.isIdentifier(descendant.callee) &&
                astBindingAt(ctx, descendant, descendant.callee.name)?.scope.isProgramScope === true
              ) {
                const name = descendant.callee.name;
                const summary =
                  ctx.importedFunctions.get(name) ??
                  (ctx.helpers.has(name) ? summarizeHelper(ctx, name) : undefined);

                for (const read of summary?.reads ?? []) {
                  callerReads.add(read);
                }
              }

              if (descendant.type === 'JSXOpeningElement') {
                const child = descendant as t.JSXOpeningElement;

                if (b.isJSXIdentifier(child.name) && /^[A-Z]/.test(child.name.name)) {
                  for (const read of componentSubtreeReads(ctx, child.name.name)) {
                    callerReads.add(read);
                  }
                }
              }
            },
          });
        }
      },
    });
  }
}

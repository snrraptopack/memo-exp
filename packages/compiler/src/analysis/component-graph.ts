import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { astBindingAt, type Ctx } from '../context';
import { containsJsx, matchMapCall } from '../lists';
import { expandRenderSlotPaths } from './slot-paths';

/** Resolve every static runtime path at which a component may be mounted. */
export function pathVariants(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) return [...linked];
  if (visiting.has(name)) {
    throw ctx.compPaths.get(name)!.buildCodeFrameError(
      `memo-dom: recursive component '${name}' — components cannot render themselves (L1)`,
    );
  }

  const listedSites = ctx.listedSites.get(name);
  if (listedSites !== undefined && listedSites.length > 0) {
    visiting.add(name);
    const output = listedSites.flatMap((site) =>
      pathVariants(ctx, site.owner, visiting).map(
        (ownerPath) => `${ownerPath}/${site.suffix}/Row[*]`,
      ),
    );
    visiting.delete(name);
    return [...new Set(output)];
  }

  const info = ctx.comps.get(name)!;
  const conditionalSites = ctx.conditionalComponentSites.get(name) ?? [];
  const rowSites = ctx.rowComponentSites.get(name) ?? [];
  if (
    info.parents.size === 0 &&
    conditionalSites.length === 0 &&
    rowSites.length === 0
  ) {
    return [ctx.rootId];
  }
  visiting.add(name);
  const output: string[] = [];
  for (const site of conditionalSites) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting)) {
      output.push(`${ownerPath}/${site.suffix}`);
    }
  }
  for (const site of rowSites) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting)) {
      output.push(`${ownerPath}/${site.suffix}`);
    }
  }
  for (const parent of info.parents) {
    const count = ctx.childRefCounts.get(parent)?.get(name) ?? 1;
    for (const parentPath of pathVariants(ctx, parent, visiting)) {
      if (count > 1) {
        output.push(`${parentPath}/${name}`, `${parentPath}/${name}[*]`);
      } else {
        output.push(`${parentPath}/${name}`);
      }
      if (ctx.usesRouter) {
        output.push(`${parentPath}/**/${name}`);
      }
    }
  }
  visiting.delete(name);
  return output;
}

/** Runtime reader patterns for static, conditional, and listed components. */
export function componentPatterns(ctx: Ctx, name: string): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) {
    return expandRenderSlotPaths(
      ctx,
      [...linked],
    );
  }
  const sites = ctx.listedSites.get(name);
  const patterns: string[] = [];
  if (sites && sites.length > 0) {
    if (isLightweightRowComponent(ctx, name)) {
      for (const site of sites) {
        const containerEnd = site.suffix.lastIndexOf('/');
        const container =
          containerEnd < 0 ? '' : `/${site.suffix.slice(0, containerEnd)}`;
        for (const variant of pathVariants(ctx, site.owner)) {
          patterns.push(`${variant}${container}`);
        }
      }
      return expandRenderSlotPaths(ctx, patterns);
    }
    for (const site of sites) {
      for (const variant of pathVariants(ctx, site.owner)) {
        patterns.push(`${variant}/${site.suffix}/Row[*]`);
      }
    }
    return expandRenderSlotPaths(ctx, patterns);
  }
  for (const variant of pathVariants(ctx, name)) {
    patterns.push(variant);
  }
  return expandRenderSlotPaths(ctx, patterns);
}

/** Whether a listed component can use the allocation-free row ABI. */
export function isLightweightListedComponent(
  ctx: Ctx,
  name: string,
): boolean {
  const imported = ctx.importedComponents.get(name);
  if (imported !== undefined) return imported.listLightweight;

  const cached = ctx.lightweightCache.get(name);
  if (cached !== undefined) return cached;

  let eligible = false;
  const sites = ctx.listedSites.get(name);
  const linkedRows = ctx.linkedComponentRows.get(name);
  if (
    ((sites !== undefined && sites.length > 0) ||
      (linkedRows !== undefined && linkedRows.length > 0)) &&
    ctx.comps.get(name)!.parents.size === 0 &&
    isListLightweightCandidate(ctx, name)
  ) {
    eligible = true;
  }
  ctx.lightweightCache.set(name, eligible);
  return eligible;
}

/**
 * Whether a component row should be called with the lightweight (props-first)
 * ABI in the list create factory. This mirrors the `lightweight` decision in
 * `transformComponent` exactly: a component is lightweight only when it passes
 * *all* of the following gates:
 *   1. `isLightweightListedComponent` (row ABI eligible)
 *   2. no transparent async-source bindings (`transparentSources`)
 *   3. no inherited data-policy parameter (`transparentPolicyParams`)
 *
 * Missing gates 2–3 was the bug: a component that closes over a transparent source
 * gets emitted as an entity-factory `function Comp(_id, _parent, _propsBox)`,
 * but the list create factory was calling it as `Comp({ item }, _rowId, ...)`,
 * mapping `{ item }` → `_id` and leaving `_propsBox` as the parent string.
 */
export function isLightweightRowComponent(ctx: Ctx, name: string): boolean {
  if (!isLightweightListedComponent(ctx, name)) return false;
  if (ctx.transparentSources.has(name)) return false;
  if (ctx.transparentPolicyParams.has(name)) return false;
  return true;
}

/** Intrinsic row shape used before graph linking marks a component listed. */
export function isListLightweightCandidate(ctx: Ctx, name: string): boolean {
  if ((ctx.instanceState.get(name)?.size ?? 0) > 0) return false;
  let eligible = true;
  const path = ctx.compPaths.get(name)!;
  walkAst<BaseNode>(path.node, {
    enter(node) {
      if (node.type === 'JSXElement') {
        const element = node as unknown as t.JSXElement;
        const tag = element.openingElement.name;
        if (astFactory.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name)) {
          eligible = false;
        }
        return;
      }
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression'
      ) {
        const call = node as unknown as
          | t.CallExpression
          | t.OptionalCallExpression;
    if (
          (astFactory.isIdentifier(call.callee, { name: 'cleanup' }) &&
            astBindingAt(ctx, node, 'cleanup') === undefined) ||
          (astFactory.isIdentifier(call.callee, { name: 'effect' }) &&
            astBindingAt(ctx, node, 'effect') === undefined)
    ) {
      eligible = false;
    }
        if (matchMapCall(call) && containsJsx(node)) {
      eligible = false;
    }
        return;
      }
      if (
        (node.type === 'ConditionalExpression' ||
          node.type === 'LogicalExpression') &&
        containsJsx(node)
      ) {
        eligible = false;
      }
    },
  });
  return eligible;
}

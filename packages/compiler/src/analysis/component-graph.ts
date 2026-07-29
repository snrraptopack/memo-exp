import * as t from '@babel/types';
import type { Ctx } from '../context';
import { containsJsx, matchMapCall } from '../lists';

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
    }
  }
  visiting.delete(name);
  return output;
}

/** Runtime reader patterns for static, conditional, and listed components. */
export function componentPatterns(ctx: Ctx, name: string): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) {
    return linked.flatMap((path) => [path, `${path}/*`]);
  }
  const sites = ctx.listedSites.get(name);
  const patterns: string[] = [];
  if (sites && sites.length > 0) {
    if (isLightweightListedComponent(ctx, name)) {
      for (const site of sites) {
        const containerEnd = site.suffix.lastIndexOf('/');
        const container =
          containerEnd < 0 ? '' : `/${site.suffix.slice(0, containerEnd)}`;
        for (const variant of pathVariants(ctx, site.owner)) {
          patterns.push(
            `${variant}${container}`,
            `${variant}${container}/*`,
          );
        }
      }
      return patterns;
    }
    for (const site of sites) {
      for (const variant of pathVariants(ctx, site.owner)) {
        patterns.push(
          `${variant}/${site.suffix}/Row[*]`,
          `${variant}/${site.suffix}/Row[*]/*`,
        );
      }
    }
    return patterns;
  }
  for (const variant of pathVariants(ctx, name)) {
    patterns.push(variant, `${variant}/*`);
  }
  return patterns;
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

/** Intrinsic row shape used before graph linking marks a component listed. */
export function isListLightweightCandidate(ctx: Ctx, name: string): boolean {
  if ((ctx.instanceState.get(name)?.size ?? 0) > 0) return false;
  let eligible = true;
  const path = ctx.compPaths.get(name)!;
  path.traverse({
    JSXElement(elementPath) {
      const tag = elementPath.node.openingElement.name;
      if (t.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name)) {
        eligible = false;
      }
    },
    CallExpression(callPath) {
      if (
        (t.isIdentifier(callPath.node.callee, { name: 'cleanup' }) &&
          callPath.scope.getBinding('cleanup') === undefined) ||
        (t.isIdentifier(callPath.node.callee, { name: 'effect' }) &&
          callPath.scope.getBinding('effect') === undefined)
      ) {
        eligible = false;
      }
      if (matchMapCall(callPath.node) && containsJsx(callPath)) {
        eligible = false;
      }
    },
    ConditionalExpression(conditionalPath) {
      if (containsJsx(conditionalPath)) eligible = false;
    },
    LogicalExpression(logicalPath) {
      if (containsJsx(logicalPath)) eligible = false;
    },
  });
  return eligible;
}

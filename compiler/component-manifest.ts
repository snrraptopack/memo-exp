/**
 * component-manifest.ts - component facts serialized by the module linker.
 *
 * This module owns AST-level component discovery and converts analyzed local
 * composition/list sites into canonical graph edges. Graph traversal itself
 * remains in component-linker.ts.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { isListLightweightCandidate } from './analysis';
import {
  canonicalStateKey,
  keyPathOf,
  type Ctx,
} from './context';
import {
  type ComponentGraphEdge,
  type ComponentGraphNode,
} from './component-linker';
import { containsJsx } from './lists';

export interface ComponentExportInfo {
  key: string;
  props: string[];
  objectProps: boolean;
  listLightweight: boolean;
}

/** Discover enough component shape to bootstrap the first import-link pass. */
export function discoverComponentExports(
  programPath: NodePath<t.Program>,
  moduleId: string,
): Map<string, ComponentExportInfo> {
  const components = new Map<string, ComponentExportInfo>();
  programPath.traverse({
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (
        name !== undefined &&
        path.scope.parent?.path.isProgram() === true &&
        containsJsx(path)
      ) {
        components.set(name, {
          key: `${moduleId}#${name}`,
          props: path.node.params
            .filter((param): param is t.Identifier => t.isIdentifier(param))
            .map((param) => param.name),
          objectProps:
            path.node.params.length === 1 &&
            t.isIdentifier(path.node.params[0], { name: 'props' }),
          listLightweight: false,
        });
      }
      path.skip();
    },
  });
  return components;
}

/** Export metadata after full binding-aware module analysis. */
export function analyzedComponentExport(
  ctx: Ctx,
  moduleId: string,
  local: string,
): ComponentExportInfo {
  return {
    key: `${moduleId}#${local}`,
    props: [...(ctx.compPropNames.get(local) ?? [])],
    objectProps: ctx.objectPropComponents.has(local),
    listLightweight: isListLightweightCandidate(ctx, local),
  };
}

function componentTarget(ctx: Ctx, name: string): string {
  return ctx.importedComponents.get(name)?.key ?? `${ctx.moduleId}#${name}`;
}

/** Convert analyzed local calls and list sites into graph placement edges. */
export function analyzedComponentDeclarations(
  moduleId: string,
  ctx: Ctx,
): ComponentGraphNode[] {
  const declarations: ComponentGraphNode[] = [];
  for (const local of ctx.comps.keys()) {
    const edges: ComponentGraphEdge[] = [];
    for (const [tag, count] of ctx.childRefCounts.get(local) ?? []) {
      const target = componentTarget(ctx, tag);
      edges.push({ target, suffix: `/${tag}`, mode: 'static' });
      if (count > 1) {
        edges.push({ target, suffix: `/${tag}[*]`, mode: 'static' });
      }
    }
    for (const [tag, sites] of ctx.listedSites) {
      for (const site of sites) {
        if (site.owner !== local) continue;
        edges.push({
          target: componentTarget(ctx, tag),
          suffix: `/${site.suffix}/Row[*]`,
          mode: 'row',
          keyPath: keyPathOf(site.keyExpr ?? null, site.itemParam ?? ''),
          sourceKey:
            site.sourceLocal === true
              ? site.sourceKey ?? ''
              : canonicalStateKey(ctx, site.sourceKey ?? ''),
          sourceLocal: site.sourceLocal ?? false,
        });
      }
    }
    declarations.push({
      key: `${moduleId}#${local}`,
      moduleId,
      local,
      edges,
    });
  }
  return declarations;
}

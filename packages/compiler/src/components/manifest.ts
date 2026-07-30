/**
 * components/manifest.ts - component facts serialized by the module linker.
 *
 * This module owns AST-level component discovery and converts analyzed local
 * composition/list sites into canonical graph edges. Graph traversal itself
 * remains in component-linker.ts.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { isListLightweightCandidate } from '../analysis';
import {
  canonicalStateKey,
  keyPathOf,
  type Ctx,
} from '../context';
import {
  type ComponentGraphEdge,
  type ComponentGraphNode,
} from '../component-linker';
import { containsJsx } from '../lists';
import { analyzeComponentProps } from './props';
import {
  collectComponentPropSources,
} from './prop-origins';

export interface ComponentExportInfo {
  key: string;
  props: string[];
  objectProps: boolean;
  acceptsUnknownProps: boolean;
  hasWholeDefault: boolean;
  listLightweight: boolean;
  renderProps: string[];
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
        /^[A-Z]/.test(name) &&
        path.scope.parent?.path.isProgram() === true &&
        containsJsx(path)
      ) {
        const props = analyzeComponentProps(path.node.params);
        components.set(name, {
          key: `${moduleId}#${name}`,
          props: [...props.names],
          objectProps: props.mode === 'object',
          acceptsUnknownProps: props.acceptsUnknown,
          hasWholeDefault: props.hasWholeDefault,
          listLightweight: false,
          renderProps: [],
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
  const props = ctx.componentProps.get(local)!;
  return {
    key: `${moduleId}#${local}`,
    props: [...props.names],
    objectProps: props.mode === 'object',
    acceptsUnknownProps: props.acceptsUnknown,
    hasWholeDefault: props.hasWholeDefault,
    listLightweight: isListLightweightCandidate(ctx, local),
    renderProps: [...props.renderProps],
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
    const propSources = collectComponentPropSources(ctx, local);
    for (const [tag, count] of ctx.childRefCounts.get(local) ?? []) {
      const target = componentTarget(ctx, tag);
      const sources = propSources.get(tag);
      edges.push({
        target,
        suffix: `/${tag}`,
        mode: 'static',
        ...(sources === undefined ? {} : { propSources: sources }),
      });
      if (count > 1) {
        edges.push({
          target,
          suffix: `/${tag}[*]`,
          mode: 'static',
          ...(sources === undefined ? {} : { propSources: sources }),
        });
      }
    }
    for (const [tag, sites] of ctx.conditionalComponentSites) {
      for (const site of sites) {
        if (site.owner !== local) continue;
        const sources = propSources.get(tag);
        edges.push({
          target: componentTarget(ctx, tag),
          suffix: `/${site.suffix}`,
          mode: 'static',
          ...(sources === undefined ? {} : { propSources: sources }),
        });
      }
    }
    for (const [tag, sites] of ctx.rowComponentSites) {
      for (const site of sites) {
        if (site.owner !== local) continue;
        const sources = propSources.get(tag);
        edges.push({
          target: componentTarget(ctx, tag),
          suffix: `/${site.suffix}`,
          mode: 'static',
          ...(sources === undefined ? {} : { propSources: sources }),
        });
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
          ...(propSources.get(tag) === undefined
            ? {}
            : { propSources: propSources.get(tag)! }),
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

/**
 * components/manifest.ts - component facts serialized by the module linker.
 *
 * This module owns AST-level component discovery and converts analyzed local
 * composition/list sites into canonical graph edges. Graph traversal itself
 * remains in component-linker.ts.
 */

import { walkAst, type BaseNode } from '../ast';
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
import { analyzeComponentPropShape } from './prop-shape';
import {
  collectComponentPropSources,
} from './prop-origins';
import { componentSubtreeReads } from '../analysis/component-reads';
import { hostJsxEventNames } from '../jsx/events';

export interface ComponentExportInfo {
  key: string;
  props: string[];
  objectProps: boolean;
  acceptsUnknownProps: boolean;
  hasWholeDefault: boolean;
  listLightweight: boolean;
  delegatedEvents: string[];
  renderProps: string[];
  renderCallbacks: string[];
  refProps: string[];
  subtreeReads: string[];
}

/** Discover enough component shape to bootstrap the first import-link pass. */
export function discoverComponentExports(
  program: BaseNode,
  moduleId: string,
): Map<string, ComponentExportInfo> {
  const components = new Map<string, ComponentExportInfo>();
  const fields = (node: BaseNode): Record<string, unknown> =>
    node as unknown as Record<string, unknown>;
  const node = (value: unknown): BaseNode | null =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
      ? (value as BaseNode)
      : null;
  const nodes = (value: unknown): BaseNode[] =>
    Array.isArray(value) ? value.filter((item): item is BaseNode => node(item) !== null) : [];
  const body = nodes(fields(program).body);
  for (const statement of body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ||
      statement.type === 'ExportDefaultDeclaration'
        ? node(fields(statement).declaration)
        : statement;
    if (declaration?.type !== 'FunctionDeclaration') continue;
    const id = node(fields(declaration).id);
    const name = id?.type === 'Identifier' ? fields(id).name : null;
    if (typeof name !== 'string' || !/^[A-Z]/.test(name)) continue;
    let hasJsx = false;
    walkAst(declaration, {
      enter(current) {
        if (current.type === 'JSXElement' || current.type === 'JSXFragment') {
          hasJsx = true;
          return false;
        }
      },
    });
    if (!hasJsx) continue;
    const props = analyzeComponentPropShape(nodes(fields(declaration).params));
    const functionBody = node(fields(declaration).body);
    components.set(name, {
      key: `${moduleId}#${name}`,
      props: [...props.names],
      objectProps: props.mode === 'object',
      acceptsUnknownProps: props.acceptsUnknown,
      hasWholeDefault: props.hasWholeDefault,
      listLightweight: false,
      delegatedEvents:
        functionBody === null ? [] : hostJsxEventNames(functionBody),
      renderProps: [],
      renderCallbacks: [],
      refProps: [],
      subtreeReads: [],
    });
  }
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
    delegatedEvents: [...(ctx.componentHostEvents.get(local) ?? [])],
    renderProps: [...props.renderProps],
    renderCallbacks: [...props.renderCallbacks],
    refProps: [...props.refProps],
    subtreeReads: [...componentSubtreeReads(ctx, local)]
      .map((key) => canonicalStateKey(ctx, key))
      .sort(),
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
      if (ctx.usesRouter) {
        edges.push({
          target,
          suffix: `/**/${tag}`,
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

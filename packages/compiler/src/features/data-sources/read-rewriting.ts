/** Coordinates transparent-source read lowering for every component. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  cloneNode as cloneEstreeNode,
  extractPatternIdentifiers,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import {
  astBindingAt,
  nodeHasJsx,
  refreshAstAnalysis,
  type Ctx,
} from '../../context';
import { mdd } from '../../identifiers';
import { wrapAutomaticSite } from './automatic-sites';
import { lowerModuleRefReadsEstree } from './module-read-lowering';
import {
  isActionRefreshTarget,
  isBoundTo,
  isDirectSourceComponentProp,
  isEventOrRefContainer,
  isEventSourceHolderReference,
  isGeneratedDataCall,
  isGroupDataContainer,
  isPassthroughArgument,
  isWithinDirectSourceComponentProp,
  isWithinGroupData,
  sourceBindings,
  sourceDependencies,
  type TransparentDerivation,
} from './read-analysis';
import {
  gateEventSourceEffects,
  isInsideRenderGate,
  replaceDerivedReads,
  replaceSourceReadsWithRenderGates,
  resolvedRenderExpression,
  trackDependencies,
} from './read-transforms';
import {
  annotateTransparentSources,
  excludeTransparentSubscriptions,
  type RenderGatedExpression,
} from './subscriptions';

export function rewriteTransparentDataReads(ctx: Ctx): void {
  const refresh = (): void => {
    const root = ctx.astAnalysis?.rootScope.block;
    if (root !== undefined) refreshAstAnalysis(ctx, root);
  };
  // Module-scope sources (RFC §16.4): lower refs to materializing reads
  // first so plain sites are safe immediately; derivation roots themselves
  // are skipped by that pass and owned by the derive pass below.
  for (const [componentName, componentPath] of ctx.compPaths) {
    lowerModuleRefReadsEstree(
      ctx,
      componentName,
      componentPath.node as unknown as BaseNode,
      refresh,
    );
  }
  refresh();
  // Module-scope refs join the same derivation machinery as component-local
  const moduleBinding = (
    component: BaseNode,
    name: string,
  ): AstBinding | undefined => {
    if (!ctx.transparentModuleSources.has(name)) return undefined;
    const binding = astBindingAt(ctx, component, name);
    return binding?.kind === 'import' ? binding : undefined;
  };

  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const localNames =
      ctx.transparentSources.get(component) ?? new Set<string>();
    const bindings = sourceBindings(ctx, componentNode, localNames);
    // Seed module-scope source bindings so derivation and container passes
    // treat imported refs like component-local holders (runtime helpers
    // accept ModuleSourceRef uniformly).
    let hasModuleRefs = false;
    for (const name of ctx.transparentModuleSources.keys()) {
      const binding = moduleBinding(componentNode, name);
      if (binding === undefined) continue;
      bindings.set(name, binding);
      hasModuleRefs = true;
    }
    if (localNames.size === 0 && !hasModuleRefs) continue;
    const names = localNames;
    const eventSources = ctx.eventSourceSlots.get(component) ?? new Set<string>();
    const tracks = ctx.transparentTrackBindings.get(component) ?? new Map();
    const derived = new Map<string, TransparentDerivation>();
    for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
      // `$track(source)` returns a stable request-state facade whose getters
      // and methods must be usable before the source's first payload commits.
      // Treating that declaration as a payload derivation initializes it to
      // `undefined` and makes controls such as `track.refresh()` crash while
      // the request is pending.
      if (derivation.bindings.some(binding => tracks.has(binding))) continue;
      let sources = derivation.sources.filter((source) => names.has(source));
      // Roots that resolve to imported module-scope sources extend the
      // dependency set even though they are not component-local holders.
      const moduleRoots: string[] = [];
      for (const name of ctx.transparentModuleSources.keys()) {
        if (bindings.has(name) && derivation.sources.includes(name)) {
          moduleRoots.push(name);
        }
      }
      sources = [...new Set([...sources, ...moduleRoots])];
      if (sources.length === 0) continue;
      const declaration = derivation.declaration;
      const target = declaration.declarations.find(
        (candidate) => candidate.init !== null &&
          extractPatternIdentifiers(candidate.id as unknown as BaseNode).some(
            (identifier) => derivation.bindings.includes(identifier.name),
          ),
      );
      const init = target?.init;
      if (init === null || init === undefined || !astFactory.isExpression(init)) continue;
      replaceDerivedReads(
        ctx,
        init as unknown as BaseNode,
        derived,
      );
      refresh();
      const projection = cloneEstreeNode(init, true);
      const wrapped = resolvedRenderExpression(
        ctx,
        init,
        sources,
        bindings,
        eventSources,
        'deriveResolvedValues',
      );
      overwriteNode(
        init as unknown as BaseNode,
        wrapped as unknown as BaseNode,
      );
      derivation.source = cloneEstreeNode(wrapped, true);
      for (const name of derivation.bindings) {
        const binding = astBindingAt(ctx, componentNode, name);
        if (binding !== undefined) {
          derived.set(name, {
            binding,
            sources,
            expression: cloneEstreeNode(projection, true),
          });
        }
      }
    }
    refresh();

    gateEventSourceEffects(ctx, component, bindings, eventSources);
    refresh();

    walkAst(componentNode, {
      enter(container) {
        if (container.type !== 'JSXExpressionContainer') return;
        if (
          isEventOrRefContainer(ctx, container) ||
          isGroupDataContainer(ctx, container) ||
          isDirectSourceComponentProp(
            ctx,
            container,
            bindings,
          )
        ) {
          return false;
        }
        const rawExpression = childNode(container, 'expression');
        if (
          rawExpression === null ||
          !astFactory.isExpression(rawExpression as unknown as t.Node)
        ) return false;
        const expression = rawExpression as unknown as t.Expression;
        if (
          (expression as t.Expression & {
            __memoDomTransparentGroup?: boolean;
          }).__memoDomTransparentGroup === true
        ) {
          // Group already owns render policy for this whole generated subtree.
          // Flatten local derivations so the structural entity can update
          // without replaying the whole component owner.
          replaceDerivedReads(
            ctx,
            rawExpression,
            derived,
          );
          return false;
        }
        const dependencies = sourceDependencies(
          ctx,
          rawExpression,
          bindings,
          derived,
          eventSources,
        );
        const stateDependencies = trackDependencies(
          ctx,
          rawExpression,
          tracks,
          bindings,
        );
        if (dependencies.length === 0) {
          if (stateDependencies.length > 0) {
            annotateTransparentSources(expression, stateDependencies);
            excludeTransparentSubscriptions(
              expression,
              stateDependencies.filter(source => eventSources.has(source)),
            );
          }
          return undefined;
        }
        const allDependencies = [
          ...new Set([...dependencies, ...stateDependencies]),
        ].sort();
        replaceDerivedReads(
          ctx,
          rawExpression,
          derived,
        );
        refresh();
        const eventDependencies = allDependencies.filter(source =>
          eventSources.has(source)
        );
        if (
          nodeHasJsx(rawExpression as unknown as t.Node) ||
          dependencies.some((source) =>
            ctx.transparentSourceProps.get(component)?.has(source) === true
          )
        ) {
          if (
            stateDependencies.length > 0 ||
            eventDependencies.length > 0
          ) {
            // Authored control flow driven by request state (RFC §5):
            // the selector and state arms evaluate immediately; payload
            // sinks self-gate per site instead of hiding behind an
            // availability ladder.
            replaceSourceReadsWithRenderGates(
              ctx,
              rawExpression,
              bindings,
              eventSources,
            );
            (expression as RenderGatedExpression).__memoDomRenderGated =
              true;
            annotateTransparentSources(expression, allDependencies);
            excludeTransparentSubscriptions(expression, eventDependencies);
            return false;
          }
          wrapAutomaticSite(ctx, component, expression, dependencies);
          return false;
        }
        const resolved = resolvedRenderExpression(
          ctx,
          expression,
          dependencies,
          bindings,
          eventSources,
        );
        annotateTransparentSources(resolved, allDependencies);
        excludeTransparentSubscriptions(resolved, eventDependencies);
        overwriteNode(rawExpression, resolved as unknown as BaseNode);
        return false;
      },
    });
    refresh();

    const imperativeReads: Array<{ identifier: BaseNode; name: string }> = [];
    walkAst(componentNode, {
      enter(sourceIdentifier) {
        if (sourceIdentifier.type !== 'Identifier') return;
        const name = (sourceIdentifier as unknown as AstIdentifier).name;
        const binding = bindings.get(name);
        if (
          binding === undefined ||
          !isBoundTo(ctx, sourceIdentifier, binding)
        ) return;
        if (
          isPassthroughArgument(ctx, sourceIdentifier) ||
          isEventSourceHolderReference(ctx, sourceIdentifier, eventSources) ||
          isActionRefreshTarget(ctx, sourceIdentifier) ||
          isWithinGroupData(ctx, sourceIdentifier) ||
          isWithinDirectSourceComponentProp(
            ctx,
            sourceIdentifier,
            bindings,
          ) ||
          isInsideRenderGate(ctx, sourceIdentifier) ||
          isGeneratedDataCall(ctx, sourceIdentifier)
        ) {
          return;
        }
        imperativeReads.push({ identifier: sourceIdentifier, name });
      },
    });
    for (const { identifier, name } of imperativeReads) {
      const site = identifier.loc === null || identifier.loc === undefined
        ? ctx.moduleId
        : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
      overwriteNode(
        identifier,
        astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
          astFactory.identifier(name),
          astFactory.stringLiteral(name),
          astFactory.stringLiteral(site),
        ]) as unknown as BaseNode,
      );
    }
    refresh();
  }
}

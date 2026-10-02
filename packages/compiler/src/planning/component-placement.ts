/** Source placement and reactive inputs; no host operations or factory ABI. */
import { keyPathOf, type Ctx } from '../context';
import { localBindingForProp, objectBindingName } from '../components/props';
import { analyzeComponentRouteSelectors, type RouteReadSelector } from '../analysis/route-selectors';

export interface ListedRowPlacement {
  readonly itemParam: string;
  readonly itemPath: readonly string[];
  readonly keyPath: readonly string[] | null;
  readonly sourceKey: string;
  readonly sourceLocal: boolean;
}

export interface ComponentPlacement {
  readonly listed: boolean;
  readonly hasLinkedRows: boolean;
  readonly sourceLocal: boolean;
  readonly row: ListedRowPlacement | null;
  readonly externalSources: readonly string[];
  readonly routeSelectors: ReadonlyMap<string, readonly RouteReadSelector[] | null>;
  readonly hasLocalEffects: boolean;
  readonly ownsRoutes: boolean;
}

export function planComponentPlacements(ctx: Ctx): ReadonlyMap<string, ComponentPlacement> {
  const placements = new Map<string, ComponentPlacement>();
  for (const [name, path] of ctx.compPaths) {
    const props = ctx.componentProps.get(name)!;
    const refs = ctx.listedSites.get(name) ?? [];
    const linkedRefs = ctx.linkedComponentRows.get(name) ?? [];
    const listed = refs.length > 0 || linkedRefs.length > 0;
    const sourceLocal = refs.some(ref => ref.sourceLocal === true) || linkedRefs.some(ref => ref.sourceLocal);
    let row: ListedRowPlacement | null = null;
    if (listed && props.bindings.length > 0) {
      const keyPaths = [
        ...refs.map(ref => keyPathOf(ref.keyExpr ?? null, ref.itemParam ?? '')),
        ...linkedRefs.map(ref => ref.keyPath),
      ];
      const first = JSON.stringify(keyPaths[0]);
      const common = keyPaths.every(candidate => JSON.stringify(candidate) === first) ? keyPaths[0]! : null;
      const directItem = localBindingForProp(props, 'item');
      const object = objectBindingName(props);
      row = {
        itemParam: directItem ?? object ?? props.bindings[0]!,
        itemPath: directItem === null && object !== null ? ['item'] : [],
        keyPath: common === null ? null : [...common],
        sourceKey: refs[0]?.sourceKey ?? linkedRefs[0]?.sourceKey ?? '',
        sourceLocal,
      };
    }
    const external = new Set<string>();
    const note = (source: string): void => {
      const root = source.split('.')[0]!;
      if (ctx.externalReactiveBindings.has(root)) external.add(root);
    };
    const effects = ctx.effects.get(name);
    if (ctx.externalReactiveBindings.size > 0) {
      for (const source of ctx.compReads.get(name) ?? []) note(source);
      for (const derivation of ctx.instanceDerivations.get(name) ?? []) {
        for (const source of derivation.sources) note(source);
      }
      for (const control of ctx.instanceControlFlow.get(name) ?? []) {
        for (const source of control.sources) note(source);
      }
      for (const effect of effects ?? []) {
        for (const source of effect.moduleReads) note(source);
        for (const source of effect.conditionModuleReads) note(source);
      }
    }
    const externalSources = [...external].sort();
    placements.set(name, {
      listed, hasLinkedRows: linkedRefs.length > 0, sourceLocal, row, externalSources,
      routeSelectors: analyzeComponentRouteSelectors(ctx, path.node,
        externalSources.filter(source => ctx.routeReactiveBindings.has(source))),
      hasLocalEffects: effects?.some(site => site.localReads.size > 0 || site.localDerivationReads.size > 0 ||
        site.conditionLocalReads.size > 0 || site.conditionLocalDerivationReads.size > 0) === true,
      ownsRoutes: ctx.localRoutes.some(route => route.ownerComponent === name),
    });
  }
  return placements;
}

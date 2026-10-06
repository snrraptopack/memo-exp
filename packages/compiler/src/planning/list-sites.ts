/** Capture list sources and composition contracts before factories are consumed. */
import type * as t from '../ast/compiler-types';
import {childNodes, childNode, nodeField, cloneNode, walkAst, type BaseNode} from '../ast';
import type {Ctx, MapCallExpression} from '../context';
import {captureMutationJournals} from '../analysis/list-mutation-journals';
import type {KeyedListMutationPlan} from '../context';
import {captureRenderCallbackProps} from '../components/render-callbacks';
import {isStaticDerivedChain} from '../lists/static-derived';
import {matchMapCall, transparentListExpression} from '../lists/source-shapes';
import type {ParentRow} from '../lists/map-site';
import type {ListCallbackPlan} from '../lists/callback-plan';
import {planListSite, type ListSiteInputs, type ListSitePlan, type ListSourceIdentity} from '../lists/site-plan';

export interface ComponentListSites {
  readonly mutationFor: (call: MapCallExpression) => KeyedListMutationPlan | undefined;
  readonly listFor: (call: MapCallExpression, callback: ListCallbackPlan, parent?: ParentRow) => ListSitePlan;
}

/** Shared read analysis can capture the current inputs; backend planning captures once per owner. */
export function captureListSiteInputs(ctx: Ctx, name: string): ListSiteInputs {
  const localRoots = new Set([
    ...(ctx.instanceState.get(name) ?? []), ...(ctx.instanceDerivedBindings.get(name) ?? []),
    ...(ctx.componentProps.get(name)?.bindings ?? []), ...(ctx.opaqueBindings.get(name) ?? []),
  ]);
  const staticDerived = new Map<string, t.Expression>();
  const seen = new Set<string>();
  const component = ctx.compPaths.get(name);
  if (component !== undefined) {
    const program = ctx.astAnalysis?.rootScope.block;
    const statements = [...(program?.type === 'Program' ? childNodes(program, 'body') : []),
      ...childNodes(component.node.body, 'body')];
    for (const statement of statements) if (statement.type === 'VariableDeclaration') {
      for (const declaration of childNodes(statement, 'declarations')) {
        const id = childNode(declaration, 'id'), init = childNode(declaration, 'init');
        if (id?.type !== 'Identifier' || init === null) continue;
        const binding = nodeField(id, 'name') as string;
        // Match existing findConstInitializer precedence: first initialized declaration wins.
        if (seen.has(binding)) continue;
        seen.add(binding);
        if (isStaticDerivedChain(init)) staticDerived.set(binding, cloneNode(transparentListExpression(init)) as t.Expression);
      }
    }
  }
  return {localRoots, state: new Map(ctx.state), staticDerived,
    components: new Set([...ctx.comps.keys(), ...ctx.importedComponents.keys()]),
    callbackProps: captureRenderCallbackProps(ctx.componentProps.get(name))};
}

export function planComponentListSites(ctx: Ctx): ReadonlyMap<string, ComponentListSites> {
  const plans = new Map<string, ComponentListSites>();
  for (const [name, path] of ctx.compPaths) {
    const inputs = captureListSiteInputs(ctx, name);
    const journals = captureMutationJournals(ctx.keyedListMutationSources.get(name));
    const identities = new WeakMap<MapCallExpression, ListSourceIdentity>();
    walkAst<BaseNode>(path.node, {enter(node) {
      const call = matchMapCall(node as t.Node);
      if (call === null) return;
      const identity = ctx.analyzedListSources.get(call);
      if (identity !== undefined) identities.set(call, {...identity});
    }});
    plans.set(name, {mutationFor: journals.forCall, listFor: (call, callback, parent) => planListSite(inputs, call,
      (message, at) => {throw path.buildCodeFrameError(message, at);}, parent, callback, identities.get(call))});
  }
  return plans;
}

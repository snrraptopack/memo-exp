/** Source publication of backend-selected linked import bindings. */
import type {Ctx,LinkedComponentImport} from '../context';
import type {ComponentPropsPlan} from '../components/props';
export interface DynamicImportBindings {
  readonly components:ReadonlyMap<string,LinkedComponentImport>;
  readonly owners:ReadonlyMap<string,readonly string[]>;
}
function linkedComponentPlan(
  component: Ctx['importedComponents'] extends Map<string, infer Value>
    ? Value
    : never,
): ComponentPropsPlan {
  return {
    mode: component.objectProps ? 'object' : 'positional',
    names: [...component.props],
    acceptsUnknown: component.acceptsUnknownProps,
    bindings: [],
    params: [],
    hasWholeDefault: component.hasWholeDefault,
    renderProps: [...(component.renderProps ?? [])],
    renderCallbacks: [...(component.renderCallbacks ?? [])],
    refProps: [...(component.refProps ?? [])],
  };
}


export function recordLinkedDynamicComponentBindings(
  ctx:Pick<Ctx,'importedComponents'|'componentProps'|'state'|'stateComponentCandidates'|'functionComponentCandidates'>,
  bindings:DynamicImportBindings,
):void {
  for(const [local,component] of bindings.components) {
    ctx.importedComponents.set(local,component);
    ctx.componentProps.set(local,linkedComponentPlan(component));
  }
  for(const [owner,locals] of bindings.owners) {
    if(ctx.state.has(owner))ctx.stateComponentCandidates.set(owner,[...locals]);
    else ctx.functionComponentCandidates.set(owner,[...locals]);
  }
}

/** Presentation component/prop ABI shared by Group and TSRX lowering. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {cloneNode} from '../../ast';
import type { DomContext as Ctx } from '../../dom/context';
import type { TransparentPresentationComponent } from '../../context';
import { generatedComponentIdentifier, generatedIdentifier } from '../../dom/identifiers';
import type {PresentationCapture,PresentationComponentPlan} from '../../planning/presentation-policy';

export function presentationCaptureProps(captures:readonly PresentationCapture[]) {
  return captures.map((capture,index)=>({prop:`capture${index}`,name:capture.name}));
}

/** Consumes source facts; performs no callback validation or capture analysis. */
export function emitPresentationComponent(
  ctx:Ctx,
  plan:PresentationComponentPlan,
  kind:'pending'|'error',
  generatedPolicies:t.FunctionDeclaration[],
):string|TransparentPresentationComponent {
  if(plan.kind==='named')return plan.name;
  const captures=presentationCaptureProps(plan.captures);
  const props:Array<{prop:string;local:t.Identifier}>=[];
  if(kind==='error') {
    props.push({prop:'error',local:plan.errorLocal===undefined?generatedIdentifier(ctx,'groupError'):cloneNode(plan.errorLocal)});
    props.push({prop:'retry',local:plan.retryLocal===undefined?generatedIdentifier(ctx,'groupRetry'):cloneNode(plan.retryLocal)});
  }
  for(const capture of captures)props.push({prop:capture.prop,local:astFactory.identifier(capture.name)});
  const component=generatedComponentIdentifier(ctx,kind==='pending'?'GroupPending':'GroupError');
  generatedPolicies.push(astFactory.functionDeclaration(
    cloneNode(component),props.length===0?[]:[objectBindingPattern(props)],
    astFactory.blockStatement(plan.body.map(statement=>cloneNode(statement,true))),
  ));
  return {component:component.name,props:captures.map(capture=>({name:capture.prop,value:astFactory.identifier(capture.name)}))};
}

export function objectBindingPattern(entries:ReadonlyArray<{prop:string;local:t.Identifier}>):t.ObjectPattern {
  return {type:'ObjectPattern',properties:entries.map(({prop,local})=>astFactory.objectProperty(
    astFactory.identifier(prop),cloneNode(local),false,prop===local.name,
  ))} as unknown as t.ObjectPattern;
}

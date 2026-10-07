/** Capture module callback ownership and authored writes before lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode,walkAst,FUNCTION_NODE_TYPES,type BaseNode} from '../ast';
import {astBindingAt,nodeHasJsx,type Ctx,type ProgramPath} from '../context';
import {isIntrinsicLifecycleCall} from '../intrinsics';
import {planHandlerWrites} from '../handlers/analyze';
import type {HandlerWritePlan} from '../handlers/plan';

type Callback=t.ArrowFunctionExpression|t.FunctionExpression|t.FunctionDeclaration;
export interface ModuleCallbackSite {
  readonly target:Callback;
  readonly executionAware:boolean;
}
export interface ModuleCallbacks {
  readonly retained:readonly ModuleCallbackSite[];
  readonly writesFor:(target:Callback,executionAware?:boolean)=>HandlerWritePlan;
}

export function planModuleCallbacks(ctx:Ctx,program:ProgramPath):ModuleCallbacks {
  const bodies=new WeakMap<Callback,Callback>();
  const retained:ModuleCallbackSite[]=[];
  const selected=new Set<Callback>();
  const capture=(target:Callback)=>{
    if(!bodies.has(target))bodies.set(target,cloneNode(target));
  };
  for(const helper of ctx.helpers.values())capture(helper.node);
  const select=(target:Callback,executionAware:boolean)=>{
    capture(target);
    if(selected.has(target))return;
    selected.add(target);retained.push({target,executionAware});
  };
  const identifier=(value:t.Identifier,executionAware:boolean)=>{
    const binding=astBindingAt(ctx,value,value.name);
    const helper=ctx.helpers.get(value.name);
    if(binding?.scope.isProgramScope&&helper)select(helper.node,executionAware);
  };
  const argument=(value:t.CallExpression['arguments'][number],executionAware=false):void=>{
    if(ctx.compilerOwnedCallbacks.has(value as t.Node))return;
    if(astFactory.isArrowFunctionExpression(value)||astFactory.isFunctionExpression(value)){
      if(!nodeHasJsx(value.body))select(value,executionAware);
    }else if(astFactory.isObjectExpression(value)){
      for(const property of value.properties){
        if(astFactory.isSpreadElement(property)&&astFactory.isExpression(property.argument))argument(property.argument,executionAware);
        else if(astFactory.isObjectProperty(property)&&astFactory.isExpression(property.value))argument(property.value,executionAware);
      }
    }else if(astFactory.isArrayExpression(value)){
      for(const element of value.elements)if(element!==null)argument(element,executionAware);
    }else if(astFactory.isIdentifier(value))identifier(value,executionAware);
  };
  const setup=(root:BaseNode,callTargets:boolean)=>{
    let depth=0;
    walkAst<BaseNode>(root,{enter(node){
      if(FUNCTION_NODE_TYPES.has(node.type)){depth++;return;}
      if(depth!==0)return;
      if(node.type==='CallExpression'){
        const call=node as unknown as t.CallExpression;
        const effect=callTargets&&isIntrinsicLifecycleCall(ctx,node,'effect');
        if(callTargets&&astFactory.isIdentifier(call.callee))identifier(call.callee,effect);
        for(const value of call.arguments)argument(value,effect);
      }else if(node.type==='NewExpression'){
        for(const value of (node as unknown as t.NewExpression).arguments)argument(value);
      }
    },leave(node){if(FUNCTION_NODE_TYPES.has(node.type))depth--;}});
  };
  setup(program.node,true);
  for(const helper of ctx.helpers.values()){
    if(helper.node.async)select(helper.node,false);
    else setup(helper.node.body,false);
  }
  return {retained,writesFor:(target,executionAware=false)=>{
    const authored=bodies.get(target);
    if(authored===undefined)throw new Error('memo-dom: module callback is missing its authored source contract');
    return planHandlerWrites(ctx,target,null,undefined,false,executionAware,authored);
  }};
}

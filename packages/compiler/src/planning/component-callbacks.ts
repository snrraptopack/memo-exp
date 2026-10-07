/** Authored callback sources; DOM targets are supplied only during lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode, type BaseNode} from '../ast';
import {astBindingAt, variableDeclaratorFor, walkNodes, nodeHasJsx, type ComponentPath, type Ctx} from '../context';
import {planHandlerWrites} from '../handlers/analyze';
import type {HandlerWritePlan} from '../handlers/plan';
import type {RowWriteFacts} from '../handlers/write-facts';

type Callback = t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
export interface CallbackSourcePlan {
  readonly target: Callback;
  readonly helpers: readonly CallbackSourcePlan[];
  readonly writesFor: (row?:RowWriteFacts,eventBoundary?:boolean) => HandlerWritePlan;
}
export interface ComponentCallbacks {
  readonly forValue: (value:t.Expression,executionAware?:boolean) => CallbackSourcePlan | null;
  readonly forEvent: (value:t.Expression,executionAware?:boolean) => CallbackSourcePlan | null;
}

/** Resolve a factory-local declaration, excluding module and nested bindings. */
export function resolveLocalHelper(ctx:Ctx, path:ComponentPath, name:string):Callback|null {
  const binding=astBindingAt(ctx,path.node as unknown as BaseNode,name);
  if (!binding || binding.scope.getFunctionScope()?.block!==path.node) return null;
  if (binding.kind==='function' && binding.declarationNode.type==='FunctionDeclaration') return binding.declarationNode as Callback;
  const init=variableDeclaratorFor(ctx,binding)?.init;
  return init && (astFactory.isArrowFunctionExpression(init)||astFactory.isFunctionExpression(init)) ? init : null;
}

export function hasConditionalRootExecution(target:Callback):boolean {
  let conditional=false;
  walkNodes(target.body,node=>{
    if(node!==target.body&&astFactory.isFunction(node))return false;
    if(['IfStatement','SwitchStatement','ConditionalExpression','LogicalExpression','ForStatement',
      'ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(node.type)){
      conditional=true;return false;
    }
  });
  return conditional;
}

/**
 * Capture lexical helper identities and immutable callback bodies before any
 * factory replacement. Semantic row facts parameterize writes; no generated
 * row id, refresh function, document or runtime identifier enters this plan.
 */
export function planComponentCallbacks(ctx:Ctx,name:string,path:ComponentPath):ComponentCallbacks {
  const sources=new Map<string,{copy:Callback;calls:readonly string[];conditional:boolean}>();
  const helpers=new Map<string,Callback>();
  const identity=(node:Callback)=>node.loc ? `${node.type}:${node.loc.start.line}:${node.loc.start.column}` : null;
  const capture=(node:Callback)=>{
    const calls=new Set<string>();
    walkNodes(node.body,child=>{
      if(astFactory.isCallExpression(child)&&astFactory.isIdentifier(child.callee))calls.add(child.callee.name);
    });
    return {copy:node,calls:[...calls],conditional:hasConditionalRootExecution(node)};
  };
  // One parser-neutral snapshot also contains every nested callback body.
  walkNodes(cloneNode(path.node),node=>{
    if(!astFactory.isFunction(node))return;
    const callback=node as Callback,key=identity(callback);
    if(key)sources.set(key,capture(callback));
  });
  for(const statement of path.node.body.body) {
    const names=astFactory.isFunctionDeclaration(statement)&&statement.id ? [statement.id.name] :
      astFactory.isVariableDeclaration(statement) ? statement.declarations.flatMap(declaration=>
        astFactory.isIdentifier(declaration.id)?[declaration.id.name]:[]) : [];
    for(const local of names){const helper=resolveLocalHelper(ctx,path,local);if(helper)helpers.set(local,helper);}
  }
  // Backend replacement mutates ComponentPath.node. Preserve the authored
  // factory references used by semantic queries, sharing publication facts.
  // Write queries need this owner only; copying the module map per component
  // would make source retention grow quadratically with component count.
  const sourceCtx={...ctx,compPaths:new Map([[name,{...path}]])};
  function sourceFor(target:Callback,executionAware:boolean,seen:Set<Callback>):CallbackSourcePlan {
    const key=identity(target),source=key&&sources.get(key)||capture(cloneNode(target));
    const reachable:CallbackSourcePlan[]=[];
    for(const local of source.calls){
      const helper=helpers.get(local);
      if(!helper||seen.has(helper))continue;
      seen.add(helper);
      const helperSource=sources.get(identity(helper)!);
      reachable.push(sourceFor(helper,helperSource?.conditional??hasConditionalRootExecution(helper),seen));
    }
    return {target,helpers:reachable,writesFor:(row,eventBoundary=false)=>
      planHandlerWrites(sourceCtx,target,name,row,eventBoundary,executionAware,source.copy)};
  }
  const resolve=(value:t.Expression,executionAware:boolean)=>{
    const target=astFactory.isArrowFunctionExpression(value)||astFactory.isFunctionExpression(value) ? value :
      astFactory.isIdentifier(value)?helpers.get(value.name):undefined;
    return target?sourceFor(target,executionAware,new Set([target])):null;
  };
  return {
    forValue:(value,executionAware=true)=>{
      const source=resolve(value,executionAware);
      return source&&!nodeHasJsx(source.target.body)?source:null;
    },
    forEvent:(value,executionAware=false)=>resolve(value,executionAware),
  };
}

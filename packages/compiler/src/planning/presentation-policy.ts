/** Authored presentation callbacks and lexical captures, before target lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  analyzeScope, cloneNode, isReferenceIdentifier, walkAst,
  type BaseNode, type Binding, type Identifier, type ScopeAnalysis,
} from '../ast';

export interface PresentationCapture {
  readonly name: string;
  readonly binding: Binding;
}

export type PresentationComponentPlan =
  | {readonly kind:'named'; readonly name:string}
  | {readonly kind:'inline'; readonly body:readonly t.Statement[];
      readonly captures:readonly PresentationCapture[];
      readonly errorLocal?:t.Identifier; readonly retryLocal?:t.Identifier};

export interface GroupPresentationPlan {
  readonly pending?:PresentationComponentPlan;
  readonly error?:PresentationComponentPlan;
  readonly suspend:boolean;
}

/** Validate all authored Group policies before any generated component exists. */
export function planGroupPresentations(
  program:t.Program,
  analysis:ScopeAnalysis|null|undefined,
  groups:ReadonlySet<string>,
  errorAt:{buildCodeFrameError(message:string,at?:t.Node):Error},
):ReadonlyMap<t.JSXElement,GroupPresentationPlan> {
  const plans=new Map<t.JSXElement,GroupPresentationPlan>();
  if(groups.size===0)return plans;
  walkAst(program as unknown as BaseNode,{enter(node){
    if(!astFactory.isJSXElement(node) || !astFactory.isJSXIdentifier(node.openingElement.name) ||
        !groups.has(node.openingElement.name.name))return;
    const attributes=new Map<string,t.JSXAttribute>();
    for(const attribute of node.openingElement.attributes) {
      if(astFactory.isJSXAttribute(attribute) && astFactory.isJSXIdentifier(attribute.name,{name:'data'})) {
        throw errorAt.buildCodeFrameError('memo-dom: Group infers colorless sources from its content; remove the data prop',attribute);
      }
      if(!astFactory.isJSXAttribute(attribute) || !astFactory.isJSXIdentifier(attribute.name) ||
          !['pending','error','suspend'].includes(attribute.name.name)) {
        throw errorAt.buildCodeFrameError('memo-dom: Group accepts pending, error, and suspend; sources are inferred from its content',attribute);
      }
      if(attributes.has(attribute.name.name))throw errorAt.buildCodeFrameError(`memo-dom: duplicate Group ${attribute.name.name} declaration`,attribute);
      attributes.set(attribute.name.name,attribute);
    }
    const suspend=attributes.get('suspend');
    if(suspend!==undefined && suspend.value!==null) {
      throw errorAt.buildCodeFrameError("memo-dom: suspend is a shorthand compiler directive; write 'suspend' without a value",suspend);
    }
    const policy=(kind:'pending'|'error'):PresentationComponentPlan|undefined=>{
      const attribute=attributes.get(kind);if(attribute===undefined)return undefined;
      if(!astFactory.isJSXExpressionContainer(attribute.value)) {
        throw errorAt.buildCodeFrameError(`memo-dom: Group ${kind} must be a component identifier or inline render callback`,attribute);
      }
      return planPresentationComponent(analysis,node as unknown as BaseNode,attribute.value.expression,kind,errorAt);
    };
    plans.set(node,Object.freeze({pending:policy('pending'),error:policy('error'),suspend:suspend!==undefined}));
  }});
  return plans;
}

/** Captures keep binding identity; generated prop names belong to lowering. */
export function planPresentationCaptures(
  analysis:ScopeAnalysis|null|undefined,
  boundary:BaseNode,
  output:BaseNode,
  excluded:ReadonlySet<string>,
):readonly PresentationCapture[] {
  const local=analyzeScope(output);
  const captures=new Map<Binding,PresentationCapture>();
  walkAst(output,{enter(node){
    if(node.type!=='Identifier')return;
    const identifier=node as Identifier;
    if(!isReferenceIdentifier(local.parentByNode.get(node)??null,local.keyByNode.get(node)) ||
        local.nodeToScope.get(node)?.getBinding(identifier.name)!==undefined ||
        excluded.has(identifier.name))return;
    const binding=analysis?.nodeToScope.get(boundary)?.getBinding(identifier.name);
    if(binding===undefined || binding.scope.isProgramScope || captures.has(binding))return;
    captures.set(binding,Object.freeze({name:binding.name,binding}));
  }});
  return Object.freeze([...captures.values()]);
}

export function planPresentationComponent(
  analysis:ScopeAnalysis|null|undefined,
  boundary:BaseNode,
  expression:t.Expression|t.JSXEmptyExpression,
  kind:'pending'|'error',
  errorAt:{buildCodeFrameError(message:string,at?:t.Node):Error},
):PresentationComponentPlan {
  if(astFactory.isIdentifier(expression))return Object.freeze({kind:'named',name:expression.name});
  if(!astFactory.isArrowFunctionExpression(expression) && !astFactory.isFunctionExpression(expression)) {
    throw errorAt.buildCodeFrameError(`memo-dom: Group ${kind} must be a component identifier or inline render callback`,expression);
  }
  if(expression.async || expression.generator) {
    throw errorAt.buildCodeFrameError(`memo-dom: Group ${kind} render callbacks must be synchronous`,expression);
  }
  if(expression.params.length>1) {
    throw errorAt.buildCodeFrameError(`memo-dom: Group ${kind} render callbacks accept at most one props parameter`,expression);
  }
  const parameter=expression.params[0];
  if(kind==='pending' && parameter!==undefined) {
    throw errorAt.buildCodeFrameError('memo-dom: Group pending render callbacks do not receive props',parameter);
  }
  if(kind==='error' && parameter!==undefined && !astFactory.isObjectPattern(parameter)) {
    throw errorAt.buildCodeFrameError('memo-dom: Group error render callbacks receive one destructured { error, retry } props object',parameter);
  }
  const localName=(name:'error'|'retry'):t.Identifier|undefined=>{
    if(!astFactory.isObjectPattern(parameter))return undefined;
    for(const property of parameter.properties) {
      if(astFactory.isObjectProperty(property) && !property.computed &&
          astFactory.isIdentifier(property.key,{name}) && astFactory.isIdentifier(property.value))return cloneNode(property.value,true);
    }
    return undefined;
  };
  return Object.freeze({
    kind:'inline',
    body:Object.freeze(astFactory.isBlockStatement(expression.body)
      ? expression.body.body.map(statement=>cloneNode(statement,true))
      : [astFactory.returnStatement(cloneNode(expression.body,true))]),
    captures:planPresentationCaptures(analysis,boundary,expression as unknown as BaseNode,new Set()),
    ...(kind==='error'?{errorLocal:localName('error'),retryLocal:localName('retry')}:{}),
  });
}

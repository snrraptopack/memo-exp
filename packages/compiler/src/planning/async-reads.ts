/** Async read meaning carried through lowering without a backend namespace. */
import {walkAst, type BaseNode} from '../ast';
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';

export interface AsyncReadFact {
  readonly sources: readonly string[];
  readonly unavailable: 'throw' | 'undefined' | 'empty-list';
}
type AsyncExpression = t.Expression & {__memoDomAsyncRead?: AsyncReadFact};
type SourceExpression=t.Expression & {
  __memoDomTransparentSources?:readonly string[];
  __memoDomTransparentSubscriptionExclusions?:readonly string[];
};

export function annotateTransparentSources(expression:t.Expression,sources:readonly string[]):void {
  const target=expression as SourceExpression;
  target.__memoDomTransparentSources=[...new Set([...(target.__memoDomTransparentSources??[]),...sources])].sort();
}

export function excludeTransparentSubscriptions(expression:t.Expression,sources:readonly string[]):void {
  if(!sources.length)return;
  walkAst(expression as unknown as BaseNode,{enter(node){
    if(!astFactory.isExpression(node as unknown as t.Node))return;
    const target=node as unknown as SourceExpression;
    target.__memoDomTransparentSubscriptionExclusions=[...new Set([
      ...(target.__memoDomTransparentSubscriptionExclusions??[]),...sources,
    ])].sort();
  }});
}

/** Dependency queries consume value facts, never generated runtime call names. */
export function transparentExpressionSources(expression:t.Expression):readonly string[] {
  const found=new Set((expression as SourceExpression).__memoDomTransparentSources??[]);
  walkAst(expression as unknown as BaseNode,{enter(node){
    for(const source of asyncReadFact(node)?.sources??[])found.add(source);
  }});
  const excluded=new Set((expression as SourceExpression).__memoDomTransparentSubscriptionExclusions??[]);
  return [...found].filter(source=>!excluded.has(source)).sort();
}

/** Clones preserve these value facts; they grant no lexical write/key proof. */
export function annotateAsyncRead<T extends t.Expression>(
  expression:T, sources:readonly string[], unavailable:AsyncReadFact['unavailable'],
):T {
  (expression as AsyncExpression).__memoDomAsyncRead={sources:[...sources],unavailable};
  return expression;
}

export function asyncReadFact(expression:BaseNode):AsyncReadFact|undefined {
  return (expression as unknown as AsyncExpression).__memoDomAsyncRead;
}

/** Sources whose unavailable scalar result needs an empty collection fallback. */
export function scalarAsyncSources(expression:t.Expression):readonly string[] {
  const sources=new Set<string>();
  walkAst(expression as unknown as BaseNode,{enter(node){
    const fact=asyncReadFact(node);
    if(fact && fact.unavailable!=='empty-list') for(const source of fact.sources)sources.add(source);
  }});
  return [...sources];
}

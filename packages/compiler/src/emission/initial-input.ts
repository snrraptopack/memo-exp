/** IDL input binding and later updates consume one proved initial host site. */
import * as astFactory from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { cloneNode } from '../ast';
import { attrExpr, type Ctx } from '../context';
import { md } from '../identifiers';
import { domPropertyWrite } from '../jsx/dom-attributes';
import { freshSlot, pushSlotUpdater, slotGuard, type EmitScope } from './scope';
import { preparationRead, registerTransparentDataSite, transparentExpressionSources } from '../data-sources';

export function emitInitialInputValue(ctx:Ctx,scope:EmitScope,node:string,attribute:t.JSXAttribute,
  owner:t.Expression,live:boolean):void {
  const expression=attrExpr(attribute.value)??astFactory.booleanLiteral(true);
  const prepared=preparationRead(ctx,scope,owner,cloneNode(expression));
  const slot=live?freshSlot(ctx,scope):null;
  const fresh=()=>slot===null ? domPropertyWrite(node,'value',cloneNode(prepared))
    : slotGuard(scope,slot,cloneNode(prepared),value=>domPropertyWrite(node,'value',value));
  const bind=astFactory.expressionStatement(astFactory.callExpression(md(ctx,'bindInitialInputValue'),[
    astFactory.identifier(node),slot===null?cloneNode(prepared)
      :astFactory.assignmentExpression('=',astFactory.identifier(slot),cloneNode(prepared)),
  ]));
  const adopting=scope.initialDom!.adopting;
  scope.creation.push(adopting?astFactory.ifStatement(adopting,bind,fresh()):bind);
  if (live) {
    registerTransparentDataSite(ctx,scope,transparentExpressionSources(expression),owner,fresh());
    pushSlotUpdater(scope,fresh,expression);
  }
}

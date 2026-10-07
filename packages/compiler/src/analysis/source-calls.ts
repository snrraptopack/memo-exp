/** Binding-aware recognition of authored provider and form calls. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type {BaseNode} from '../ast';
import {astBindingAt,type Ctx} from '../context';

export function isCallToImported(
  ctx:Ctx,component:BaseNode,call:t.Expression|null|undefined,names:ReadonlySet<string>,
):boolean {
  if(!astFactory.isCallExpression(call)||!astFactory.isIdentifier(call.callee)||!names.has(call.callee.name))return false;
  return astBindingAt(ctx,component,call.callee.name)?.kind==='import';
}

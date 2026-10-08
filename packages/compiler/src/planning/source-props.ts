/** Lexical projections of transparent source props, before alias allocation. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { astBindingAt, type Ctx } from '../context';
import { localBindingForProp, objectBindingName } from '../components/props';

export type SourcePropProjection =
  | { readonly kind:'binding'; readonly prop:string; readonly binding:string }
  | { readonly kind:'object'; readonly prop:string; readonly objectBinding:string;
      readonly declaration:t.FunctionDeclaration; readonly reads:readonly BaseNode[] };

export function planSourcePropProjections(ctx: Ctx, component: string): readonly SourcePropProjection[] {
  const plan = ctx.componentProps.get(component);
  const path = ctx.compPaths.get(component);
  if (plan === undefined || path === undefined) return [];
  const objectBinding = objectBindingName(plan);
  const identity = objectBinding === null ? undefined : astBindingAt(ctx,path.node,objectBinding);
  const projections:SourcePropProjection[] = [];
  for (const [prop,origin] of ctx.linkedComponentPropSources.get(component) ?? []) {
    if (origin.transparent !== true) continue;
    const binding = localBindingForProp(plan,prop);
    if (binding !== null) {
      projections.push(Object.freeze({kind:'binding',prop,binding}));
      continue;
    }
    if (objectBinding === null || identity === undefined) continue;
    const reads:BaseNode[] = [];
    walkAst<BaseNode>(path.node,{enter(node) {
      if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return;
      const member = node as unknown as t.MemberExpression | t.OptionalMemberExpression;
      if (!astFactory.isIdentifier(member.object,{name:objectBinding}) ||
          astBindingAt(ctx,member.object,objectBinding)?.identifier !== identity.identifier) return;
      const key = member.computed
        ? astFactory.isStringLiteral(member.property) ? member.property.value : null
        : astFactory.isIdentifier(member.property) ? member.property.name : null;
      if (key === prop) reads.push(node);
    }});
    projections.push(Object.freeze({kind:'object',prop,objectBinding,declaration:path.node,reads:Object.freeze(reads)}));
  }
  return Object.freeze(projections);
}

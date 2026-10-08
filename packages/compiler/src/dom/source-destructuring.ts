/** Lower validated source projections; generated holders/default caches are DOM ABI. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode } from '../ast';
import type { SourceDestructuringPlan, SourceProjection } from '../planning/source-destructuring';
import type { DomContext } from './context';
import { generatedIdentifier } from './identifiers';

export function lowerSourceDestructuring(ctx: DomContext, plans: readonly SourceDestructuringPlan[]): void {
  const access = (object: t.Expression, key: t.Expression, computed: boolean) =>
    astFactory.memberExpression(cloneNode(object), cloneNode(key), computed);
  const lower = (plan: SourceProjection, value: t.Expression, declarations: t.VariableDeclarator[]): void => {
    switch (plan.kind) {
      case 'binding':
        declarations.push(astFactory.variableDeclarator(plan.identifier, value));
        return;
      case 'default': {
        const cache = generatedIdentifier(ctx, 'destructuredValue');
        declarations.push(astFactory.variableDeclarator(cache, value));
        lower(plan.target, astFactory.conditionalExpression(
          astFactory.binaryExpression('===', astFactory.identifier(cache.name), astFactory.identifier('undefined')),
          plan.fallback, astFactory.identifier(cache.name),
        ), declarations);
        return;
      }
      case 'array':
        for (const entry of plan.entries) lower(entry.target, entry.rest
          ? astFactory.callExpression(access(value, astFactory.identifier('slice'), false), [astFactory.numericLiteral(entry.index)])
          : access(value, astFactory.numericLiteral(entry.index), true), declarations);
        return;
      case 'object':
        for (const entry of plan.entries) lower(entry.target, access(value, entry.key, entry.computed), declarations);
    }
  };
  for (const plan of plans) {
    const declarations: t.VariableDeclarator[] = [];
    for (const entry of plan.entries) {
      if (entry.kind === 'retain') { declarations.push(entry.declaration); continue; }
      let value: t.Expression;
      if (entry.source.kind === 'binding') value = astFactory.identifier(entry.source.name);
      else {
        const holder = generatedIdentifier(ctx, 'destructuredSource');
        declarations.push(astFactory.variableDeclarator(holder, entry.source.expression));
        value = astFactory.identifier(holder.name);
      }
      lower(entry.projection, value, declarations);
    }
    plan.declaration.declarations = declarations;
  }
}

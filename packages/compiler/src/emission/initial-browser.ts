/** DOM backend for the interactive placements in an HTML-associated root. */
import * as astFactory from '../ast/factory';
import { walkAst, identifierLikeName, childNode } from '../ast';
import type { Ctx } from '../context';
import type { EmitScope } from './scope';
import type { JsxNode } from '../jsx/children';
import type { InitialBrowserRoot } from '../planning/initial-browser';
import { initialSite } from '../planning/initial-render';
import { generatedIdentifier, md } from '../identifiers';

export function emitInitialBrowserRoot(
  ctx: Ctx, scope: EmitScope, node: JsxNode, plan: InitialBrowserRoot,
  emitRegion: (node: JsxNode) => string,
): string {
  const requested = new Map(plan.regions.map(region => [region.site, region.id]));
  const placements: ReturnType<typeof astFactory.arrayExpression>[] = [];
  walkAst(node, { enter(child) {
    if (child.type !== 'JSXElement') return;
    const tag = identifierLikeName(childNode(childNode(child, 'openingElement')!, 'name'));
    if (!tag || !/^[A-Z]/.test(tag)) return;
    const id = requested.get(initialSite(child));
    if (id !== undefined) placements.push(astFactory.arrayExpression([
      astFactory.numericLiteral(id), astFactory.identifier(emitRegion(child as JsxNode)),
    ]));
    else scope.childCounts.set(tag, (scope.childCounts.get(tag) ?? 0) + 1);
    // Authored component children belong to that component's slot scopes.
    return false;
  } });
  if (placements.length !== plan.regions.length) throw new Error('memo-dom: initial browser placement is missing its authored JSX site');
  const variable = generatedIdentifier(ctx, 'initialRoot');
  scope.creation.push(astFactory.variableDeclaration('const', [astFactory.variableDeclarator(variable,
    astFactory.callExpression(md(ctx, 'adoptInitialRoot'), [
      astFactory.stringLiteral(plan.target), astFactory.arrayExpression(placements),
    ]),
  )]));
  return variable.name;
}

/** DOM owns selector allocation; JSX replacement is shared with desktop. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { DynamicTagPlan } from '../planning/dynamic-tags';
import { lowerPlannedDynamicTags } from '../emission/dynamic-tags';
import type { DomContext as Ctx } from './context';
import { generatedIdentifier } from './identifiers';
export { lowerLinkedDynamicComponentImports } from '../emission/dynamic-imports';

export function lowerDynamicTags(ctx: Ctx, plan: DynamicTagPlan): void {
  lowerPlannedDynamicTags(ctx, plan, () => {
    const scratch =
      ctx.emission.dynamicTagSelector ??
      (ctx.emission.dynamicTagSelector = generatedIdentifier(ctx, 'dynamicTagSelector').name);
    if (ctx.emission.header.every((node) => !isDynamicTagScratchDecl(node, scratch))) {
      ctx.emission.header.push(
        astFactory.variableDeclaration('let', [
          astFactory.variableDeclarator(astFactory.identifier(scratch)),
        ]),
      );
    }
    return scratch;
  });
}

function isDynamicTagScratchDecl(node: t.Statement, name: string): boolean {
  return (
    astFactory.isVariableDeclaration(node) &&
    node.declarations.some(
      (declaration) => astFactory.isIdentifier(declaration.id) && declaration.id.name === name,
    )
  );
}

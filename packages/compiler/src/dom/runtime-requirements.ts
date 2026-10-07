import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';

/** Runtime capabilities belong to retained backend output, not attempted emission. */
export function emittedRuntimeHelpers(program: BaseNode, runtimeId: string): ReadonlySet<string> {
  const helpers = new Set<string>();
  walkAst(program, {
    enter(node) {
      if (!astFactory.isMemberExpression(node) && !astFactory.isOptionalMemberExpression(node)) return;
      if (!astFactory.isIdentifier(node.object, { name: runtimeId })) return;
      if (!node.computed && astFactory.isIdentifier(node.property)) {
        helpers.add(node.property.name);
      } else if (node.computed && astFactory.isStringLiteral(node.property)) {
        helpers.add(node.property.value);
      } else {
        // A generated dynamic lookup cannot prove either adoption feature absent.
        helpers.add('createListRegion');
        helpers.add('materializeMarkup');
      }
    },
  });
  return helpers;
}

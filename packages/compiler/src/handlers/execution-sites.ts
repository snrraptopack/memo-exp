/** Shared evaluation-order-preserving execution flags for authored writes. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { Ctx } from '../context';
import { HandlerPath } from './traversal';
import { isPlainDataAssignment } from './member-assignment';

export function markExecutionSite(
  ctx: Ctx,
  rootFn: t.Node,
  path: HandlerPath,
  flag: t.Identifier,
  emitter: { fresh(name: string): t.Identifier; runtime(name: string): t.Expression },
): t.Identifier[] {
  if (
    path.isAssignmentExpression({ operator: '=' }) &&
    (astFactory.isIdentifier(path.node.left) ||
      (astFactory.isMemberExpression(path.node.left) &&
        !astFactory.isSuper(path.node.left.object) &&
        !astFactory.isPrivateName(path.node.left.property) &&
        isPlainDataAssignment(ctx, rootFn, path.node.left, path.scope)))
  ) {
    const original = path.node;
    const previous = emitter.fresh('previousValue');
    const result = emitter.fresh('assignedValue');
    const temporaries = [previous, result];
    let before: t.Expression;
    let assignment: t.AssignmentExpression;
    let after: t.Expression;

    if (astFactory.isIdentifier(original.left)) {
      before = astFactory.identifier(original.left.name);
      assignment = cloneEstreeNode(original, true);
      after = astFactory.identifier(original.left.name);
    } else if (astFactory.isMemberExpression(original.left)) {
      const receiver = emitter.fresh('assignmentReceiver');
      const property = emitter.fresh('assignmentProperty');
      temporaries.push(receiver, property);
      const access = (): t.MemberExpression =>
        astFactory.memberExpression(cloneEstreeNode(receiver), cloneEstreeNode(property), true);
      const propertyExpression = original.left.computed
        ? cloneEstreeNode(original.left.property as t.Expression, true)
        : astFactory.stringLiteral((original.left.property as t.Identifier).name);
      before = astFactory.sequenceExpression([
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(receiver),
          cloneEstreeNode(original.left.object as t.Expression, true),
        ),
        astFactory.assignmentExpression('=', cloneEstreeNode(property), propertyExpression),
        access(),
      ]);
      assignment = astFactory.assignmentExpression(
        '=',
        access(),
        cloneEstreeNode(original.right, true),
      );
      after = access();
    } else {
      return [];
    }

    path.replaceWith(
      astFactory.sequenceExpression([
        astFactory.assignmentExpression('=', cloneEstreeNode(previous), before),
        astFactory.assignmentExpression('=', cloneEstreeNode(result), assignment),
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(flag),
          astFactory.logicalExpression(
            '||',
            cloneEstreeNode(flag),
            astFactory.callExpression(emitter.runtime('effectAssignmentChanged'), [
              cloneEstreeNode(previous),
              after,
            ]),
          ),
        ),
        cloneEstreeNode(result),
      ]),
    );
    return temporaries;
  }

  const mark = astFactory.assignmentExpression(
    '=',
    cloneEstreeNode(flag),
    astFactory.booleanLiteral(true),
  );
  if (path.isAssignmentExpression() && ['&&=', '||=', '??='].includes(path.node.operator)) {
    // Logical assignments can evaluate the receiver without executing a write.
    // Keep the native reference and key coercion; only mark the taken RHS.
    path.node.right = astFactory.sequenceExpression([mark, path.node.right]);
    return [];
  }
  if (path.isVariableDeclarator()) {
    const init = path.node.init;
    if (init === null || !astFactory.isExpression(init)) {
      throw new Error('memo-dom: execution-aware variable site has no expression initializer');
    }
    path.node.init = astFactory.sequenceExpression([mark, init]);
    return [];
  }
  if (!path.isExpression()) {
    throw new Error(`memo-dom: unsupported execution-aware write site '${path.node.type}'`);
  }
  path.replaceWith(astFactory.sequenceExpression([mark, cloneEstreeNode(path.node, true)]));
  return [];
}

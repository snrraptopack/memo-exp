/** Authored read creation operations and their lexical placement, before lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode, unwrapTypeExpression, variableDeclaratorForBinding, walkAst,
  type BaseNode, type Binding, type ScopeAnalysis,
} from '../ast';

type ReplayPlacement =
  | {readonly kind: 'declarators'; readonly entries: t.VariableDeclarator[]; readonly before: t.VariableDeclarator}
  | {readonly kind: 'statements'; readonly entries: t.Statement[]; readonly before: t.Statement};

export interface ReadReplayPlan {
  readonly call: t.CallExpression;
  readonly expression: t.Expression;
  /** A crossing read retains the operation beside its original declaration. */
  readonly origin?: t.VariableDeclarator;
  readonly placement?: ReplayPlacement;
}

export function planReadReplays(
  program: t.Program,
  analysis: ScopeAnalysis,
  factories: ReadonlySet<string>,
): readonly ReadReplayPlan[] {
  const plans: ReadReplayPlan[] = [];
  if (factories.size === 0) return Object.freeze(plans);
  walkAst(program as unknown as BaseNode, {enter(node) {
    if (!astFactory.isCallExpression(node) || !astFactory.isIdentifier(node.callee) ||
        !factories.has(node.callee.name) ||
        analysis.nodeToScope.get(node)?.getBinding(node.callee.name)?.kind !== 'import' ||
        node.arguments.length !== 1 || !astFactory.isExpression(node.arguments[0])) return;
    let expression = node.arguments[0];
    let origin: t.VariableDeclarator | undefined;
    const seen = new Set<Binding>();
    for (;;) {
      const unwrapped = unwrapTypeExpression(expression as unknown as BaseNode);
      if (!astFactory.isIdentifier(unwrapped)) break;
      const binding = analysis.nodeToScope.get(unwrapped)?.getBinding(unwrapped.name);
      const declaration = binding === undefined ? null : variableDeclaratorForBinding(analysis, binding);
      if (binding === undefined || binding.kind !== 'const' || binding.constantViolations.length > 0 ||
          seen.has(binding) || !astFactory.isVariableDeclarator(declaration) ||
          !astFactory.isIdentifier(declaration.id) || declaration.id !== binding.identifier ||
          !astFactory.isExpression(declaration.init)) break;
      seen.add(binding);
      origin = declaration;
      expression = declaration.init;
    }
    let placement: ReplayPlacement | undefined;
    if (origin !== undefined && analysis.nodeToScope.get(expression) !== analysis.nodeToScope.get(node)) {
      const declaration = analysis.parentByNode.get(origin as unknown as BaseNode);
      if (!astFactory.isVariableDeclaration(declaration)) throw new Error('memo-dom: missing read creation declaration');
      const parent = analysis.parentByNode.get(declaration as unknown as BaseNode);
      // Keep generated factories private when the authored promise is exported.
      placement = astFactory.isExportNamedDeclaration(parent)
        ? Object.freeze({kind: 'statements', entries: program.body, before: parent})
        : Object.freeze({kind: 'declarators', entries: declaration.declarations, before: origin});
    }
    plans.push(Object.freeze({call: node, expression: cloneNode(expression, true),
      ...(placement === undefined ? {} : {origin, placement})}));
  }});
  return Object.freeze(plans);
}

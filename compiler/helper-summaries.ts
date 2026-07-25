/**
 * helper-summaries.ts - interprocedural effects for module-local helpers.
 *
 * Summaries preserve exact module write keys where provenance is provable.
 * Parameter mutations, dynamic paths, recursive calls, and mutable values
 * passed to unknown code are marked opaque for conservative callers.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  MUTATOR_METHODS,
  type Ctx,
  type FnSummary,
} from './context';
import {
  AliasTracker,
  callArgumentExpressions,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from './mutation-analysis';

/** Read/write summary of a module-level helper, memoized and cycle-safe. */
export function summarizeHelper(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
): FnSummary {
  const cached = ctx.helperSummaries.get(name);
  if (cached) return cached;
  if (visiting.has(name)) {
    return { reads: new Set(), writes: new Set(), opaque: true };
  }

  const path = ctx.helpers.get(name)!;
  const locals = new Set<string>();
  const parameters = new Set(
    path.node.params.filter(t.isIdentifier).map((param) => param.name),
  );
  const summary: FnSummary = {
    reads: new Set(),
    writes: new Set(),
    opaque: false,
  };
  const aliases = new AliasTracker((bindingName, binding) => {
    if (parameters.has(bindingName) && binding?.scope.block === path.node) {
      return { locality: 'prop', root: bindingName, key: bindingName };
    }
    const kind = ctx.state.get(bindingName);
    if (kind === undefined) return null;
    if (binding !== undefined && !binding.scope.path.isProgram()) return null;
    return moduleOrigin(bindingName, kind);
  });

  visiting.add(name);
  path.traverse({
    VariableDeclarator(declarator) {
      if (!t.isIdentifier(declarator.node.id)) return;
      locals.add(declarator.node.id.name);
      if (declarator.parentPath.isVariableDeclaration()) {
        aliases.trackDeclarator(
          declarator.scope,
          declarator.node,
        );
      }
    },
    Function(fn) {
      for (const param of fn.node.params) {
        if (t.isIdentifier(param)) locals.add(param.name);
      }
    },
  });

  const markOpaque = (origin: ReactiveOrigin): void => {
    summary.opaque = true;
    if (origin.locality !== 'module') return;
    summary.writes.add(origin.root);
    ctx.opaqueVars.add(origin.root);
  };

  const noteOriginWrite = (origin: ReactiveOrigin): void => {
    if (origin.locality !== 'module') {
      summary.opaque = true;
    } else if (origin.stateKind !== 'store') {
      summary.writes.add(origin.root);
    } else if (origin.key !== null && origin.key.includes('.')) {
      summary.writes.add(origin.key);
    } else {
      markOpaque(origin);
    }
  };

  const noteMemberWrite = (
    nodePath: NodePath,
    node: t.MemberExpression,
  ): void => {
    const origin = aliases.resolveExpression(nodePath.scope, node);
    if (origin !== null) noteOriginWrite(origin);
  };

  const markOpaqueArguments = (
    nodePath: NodePath,
    args: t.CallExpression['arguments'],
  ): void => {
    for (const expression of callArgumentExpressions(args)) {
      if (!t.isIdentifier(expression)) continue;
      const origin = aliases.resolveExpression(nodePath.scope, expression);
      if (origin !== null) markOpaque(origin);
    }
  };

  path.traverse({
    VariableDeclarator(declarator) {
      if (
        !t.isIdentifier(declarator.node.id) &&
        declarator.node.init !== null
      ) {
        for (
          const origin of aliases.referencedOrigins(
            declarator.scope,
            declarator.node.init as t.Expression,
          )
        ) {
          markOpaque(origin);
        }
      }
    },
    AssignmentExpression(assignment) {
      const left = assignment.node.left;
      if (t.isIdentifier(left)) {
        if (locals.has(left.name)) {
          if (t.isIdentifier(assignment.node.right)) {
            const origin = aliases.resolveExpression(
              assignment.scope,
              assignment.node.right,
            );
            if (origin !== null) markOpaque(origin);
          }
        } else if (ctx.state.has(left.name)) {
          summary.writes.add(left.name);
        }
      } else if (t.isMemberExpression(left)) {
        noteMemberWrite(assignment, left);
      } else {
        for (
          const origin of aliases.referencedOrigins(
            assignment.scope,
            assignment.node.right,
          )
        ) {
          markOpaque(origin);
        }
      }
    },
    UpdateExpression(update) {
      const argument = update.node.argument;
      if (t.isIdentifier(argument)) {
        if (!locals.has(argument.name) && ctx.state.has(argument.name)) {
          summary.writes.add(argument.name);
        }
      } else if (t.isMemberExpression(argument)) {
        noteMemberWrite(update, argument);
      }
    },
    UnaryExpression(unary) {
      if (
        unary.node.operator === 'delete' &&
        t.isMemberExpression(unary.node.argument)
      ) {
        noteMemberWrite(unary, unary.node.argument);
      }
    },
    CallExpression(call) {
      const callee = call.node.callee;
      if (t.isMemberExpression(callee)) {
        const method = memberName(callee);
        if (
          method === 'assign' &&
          t.isIdentifier(callee.object, { name: 'Object' })
        ) {
          const targetArg = call.node.arguments[0];
          const target =
            targetArg !== undefined && t.isExpression(targetArg)
              ? aliases.resolveExpression(call.scope, targetArg)
              : null;
          if (target !== null) {
            if (
              target.locality === 'module' &&
              target.stateKind === 'store'
            ) {
              const keys = staticAssignedKeys(
                target,
                call.node.arguments.slice(1),
              );
              if (keys === null) markOpaque(target);
              else for (const key of keys) summary.writes.add(key);
            } else {
              noteOriginWrite(target);
            }
          }
          return;
        }

        if (method !== null && MUTATOR_METHODS.has(method)) {
          if (t.isExpression(callee.object)) {
            const origin = aliases.resolveExpression(call.scope, callee.object);
            if (origin !== null) noteOriginWrite(origin);
          }
          return;
        }

        markOpaqueArguments(call, call.node.arguments);
        return;
      }

      if (
        t.isIdentifier(callee) &&
        (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name))
      ) {
        const nested =
          ctx.importedFunctions.get(callee.name) ??
          summarizeHelper(ctx, callee.name, visiting);
        for (const read of nested.reads) summary.reads.add(read);
        for (const write of nested.writes) summary.writes.add(write);
        if (nested.opaque) {
          summary.opaque = true;
          markOpaqueArguments(call, call.node.arguments);
        }
        return;
      }
      markOpaqueArguments(call, call.node.arguments);
    },
    Identifier(identifier) {
      const identifierName = identifier.node.name;
      if (!ctx.state.has(identifierName) || locals.has(identifierName)) return;
      const parent = identifier.parentPath;
      if (
        parent.isAssignmentExpression({ operator: '=' }) &&
        parent.node.left === identifier.node
      ) {
        return;
      }
      summary.reads.add(identifierName);
    },
    MemberExpression(member) {
      const key = storeReadKey(ctx, member);
      if (key !== null) summary.reads.add(key);
    },
  });

  visiting.delete(name);
  ctx.helperSummaries.set(name, summary);
  return summary;
}

function storeReadKey(
  ctx: Ctx,
  member: NodePath<t.MemberExpression>,
): string | null {
  const key = memberKey(member.node);
  if (!key || !key.includes('.')) return null;
  const root = key.split('.')[0]!;
  if (ctx.state.get(root) !== 'store') return null;
  if (member.scope.getBinding(root)?.scope.path.isProgram() !== true) return null;
  const parent = member.parentPath;
  if (
    parent.isAssignmentExpression({ operator: '=' }) &&
    parent.node.left === member.node
  ) {
    return null;
  }
  if (isMutatorCallee(member)) return null;
  return key;
}

function isMutatorCallee(member: NodePath<t.MemberExpression>): boolean {
  const parent = member.parentPath;
  if (!parent.isCallExpression() || parent.node.callee !== member.node) {
    return false;
  }
  const method = memberName(member.node);
  return method !== null && MUTATOR_METHODS.has(method);
}

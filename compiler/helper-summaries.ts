/**
 * helper-summaries.ts - interprocedural effects for module-local helpers.
 *
 * Summaries distinguish exact writes from effects conservatively bounded to
 * a receiver. Parameter receiver effects are retained by argument position,
 * so callers can map them back to their own state. Only effects with no
 * finite receiver/argument boundary are unbounded.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  type Ctx,
  type FnSummary,
} from './context';
import {
  AliasTracker,
  callArgumentExpressions,
  extendOrigin,
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
    return {
      reads: new Set(),
      writes: new Set(),
      boundedWrites: new Set(),
      parameterWrites: [],
      unbounded: true,
    };
  }

  const path = ctx.helpers.get(name)!;
  const locals = new Set<string>();
  const parameterIndexes = new Map(
    path.node.params.flatMap((param, index) =>
      t.isIdentifier(param) ? [[param.name, index] as const] : [],
    ),
  );
  const summary: FnSummary = {
    reads: new Set(),
    writes: new Set(),
    boundedWrites: new Set(),
    parameterWrites: [],
    unbounded: false,
  };
  const aliases = new AliasTracker((bindingName, binding) => {
    if (
      parameterIndexes.has(bindingName) &&
      binding?.scope.block === path.node
    ) {
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

  const addParameterWrite = (index: number, path: string[]): void => {
    if (
      summary.parameterWrites.some(
        (effect) =>
          effect.index === index &&
          effect.path.length === path.length &&
          effect.path.every((part, partIndex) => part === path[partIndex]),
      )
    ) {
      return;
    }
    summary.parameterWrites.push({ index, path });
  };

  const noteReceiverEffect = (origin: ReactiveOrigin): void => {
    if (origin.locality === 'module') {
      summary.boundedWrites.add(origin.key ?? origin.root);
      return;
    }
    if (origin.locality === 'prop') {
      const index = parameterIndexes.get(origin.root);
      if (index !== undefined) {
        const path =
          origin.key === null ? [] : origin.key.split('.').slice(1);
        addParameterWrite(index, path);
        return;
      }
    }
    summary.unbounded = true;
  };

  const noteOriginWrite = (origin: ReactiveOrigin): void => {
    if (origin.locality === 'prop') {
      noteReceiverEffect(origin);
    } else if (origin.locality !== 'module') {
      summary.unbounded = true;
    } else if (origin.stateKind !== 'store') {
      summary.writes.add(origin.root);
    } else if (origin.key !== null && origin.key.includes('.')) {
      summary.writes.add(origin.key);
    } else {
      summary.boundedWrites.add(origin.root);
    }
  };

  const noteMemberWrite = (
    nodePath: NodePath,
    node: t.MemberExpression,
  ): void => {
    const origin = aliases.resolveExpression(nodePath.scope, node);
    if (origin !== null) noteOriginWrite(origin);
  };

  const noteBoundedArguments = (
    nodePath: NodePath,
    args: t.CallExpression['arguments'],
  ): void => {
    for (const expression of callArgumentExpressions(args)) {
      if (!t.isIdentifier(expression)) continue;
      const origin = aliases.resolveExpression(nodePath.scope, expression);
      if (origin !== null) noteReceiverEffect(origin);
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
          noteReceiverEffect(origin);
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
            if (origin !== null) noteReceiverEffect(origin);
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
          noteReceiverEffect(origin);
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
            const keys = staticAssignedKeys(
              target,
              call.node.arguments.slice(1),
            );
            if (keys === null) {
              noteReceiverEffect(target);
            } else {
              for (const key of keys) {
                noteOriginWrite({ ...target, key });
              }
            }
          }
          return;
        }

        const receiver =
          t.isExpression(callee.object)
            ? aliases.resolveExpression(call.scope, callee.object)
            : null;
        if (receiver !== null) {
          noteReceiverEffect(receiver);
        } else {
          noteBoundedArguments(call, call.node.arguments);
        }
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
        for (const write of nested.boundedWrites) {
          summary.boundedWrites.add(write);
        }
        for (const effect of nested.parameterWrites) {
          const argument = call.node.arguments[effect.index];
          if (argument === undefined || !t.isExpression(argument)) continue;
          const origin = aliases.resolveExpression(call.scope, argument);
          if (origin !== null) {
            noteReceiverEffect(extendOrigin(origin, effect.path));
          }
        }
        if (nested.unbounded) {
          summary.unbounded = true;
        }
        return;
      }
      noteBoundedArguments(call, call.node.arguments);
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
  if (isMemberCallCallee(member)) return null;
  return key;
}

function isMemberCallCallee(member: NodePath<t.MemberExpression>): boolean {
  const parent = member.parentPath;
  return parent.isCallExpression() && parent.node.callee === member.node;
}

/**
 * Interprocedural read/write summaries for module-local helpers.
 *
 * Summaries distinguish exact writes from effects conservatively bounded to
 * a receiver. Parameter receiver effects are retained by argument position,
 * so callers can map them back to their own state.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  childNode,
  childNodes,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Scope,
} from './ast';
import {
  astBindingAt,
  astScopeAt,
  memberKey,
  refreshAstAnalysis,
  type Ctx,
  type FnSummary,
} from './context';
import {
  AliasTracker,
  bindingScopeIsProgram,
  extendOrigin,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from './mutation-analysis';

function scopeAt(ctx: Ctx, at: BaseNode): Scope {
  let scope = astScopeAt(ctx, at);
  if (scope === undefined) {
    const program = ctx.astAnalysis?.rootScope.block;
    if (program?.type === 'Program') {
      refreshAstAnalysis(ctx, program);
      scope = astScopeAt(ctx, at);
    }
  }
  if (scope === undefined) {
    throw new Error('memo-dom: missing ESTree scope during helper analysis');
  }
  return scope;
}

function argumentExpressions(call: BaseNode): BaseNode[] {
  return childNodes(call, 'arguments').flatMap((argument) => {
    if (argument.type === 'SpreadElement') {
      const expression = childNode(argument, 'argument');
      return expression === null ? [] : [expression];
    }
    return argument.type === 'JSXNamespacedName' ||
      argument.type === 'ArgumentPlaceholder'
      ? []
      : [argument];
  });
}

function assignmentLeftIs(
  ctx: Ctx,
  current: BaseNode,
  candidate: BaseNode,
): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  return (
    parent?.type === 'AssignmentExpression' &&
    fields(parent).operator === '=' &&
    childNode(parent, 'left') === candidate
  );
}

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

  const helper = ctx.helpers.get(name)!.node;
  const helperNode = helper as unknown as BaseNode;
  const locals = new Set<string>();
  const parameterIndexes = new Map(
    helper.params.flatMap((parameter, index) =>
      astFactory.isIdentifier(parameter) ? [[parameter.name, index] as const] : [],
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
      binding?.scope.block === helperNode
    ) {
      return { locality: 'prop', root: bindingName, key: bindingName };
    }
    const kind = ctx.state.get(bindingName);
    if (kind === undefined) return null;
    if (binding !== undefined && !bindingScopeIsProgram(binding)) return null;
    return moduleOrigin(bindingName, kind);
  });
  const isComputedOrigin = (origin: ReactiveOrigin): boolean =>
    origin.stateKind === 'computed' || ctx.state.get(origin.root) === 'computed';

  visiting.add(name);
  walkAst<BaseNode>(helperNode, {
    enter(current) {
      if (current.type === 'VariableDeclarator') {
        const declarationName = identifierName(childNode(current, 'id'));
        if (declarationName === null) return;
        locals.add(declarationName);
        aliases.trackDeclarator(
          scopeAt(ctx, current),
          current as unknown as t.VariableDeclarator,
        );
        return;
      }
      if (
        current.type === 'FunctionDeclaration' ||
        current.type === 'FunctionExpression' ||
        current.type === 'ArrowFunctionExpression' ||
        current.type === 'ObjectMethod' ||
        current.type === 'ClassMethod' ||
        current.type === 'ClassPrivateMethod'
      ) {
        for (const parameter of childNodes(current, 'params')) {
          const parameterName = identifierName(parameter);
          if (parameterName !== null) locals.add(parameterName);
        }
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
    if (isComputedOrigin(origin)) return;
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

  const noteMemberWrite = (at: BaseNode, member: BaseNode): void => {
    const origin = aliases.resolveExpression(
      scopeAt(ctx, at),
      member as unknown as t.MemberExpression,
    );
    if (origin !== null) noteOriginWrite(origin);
  };

  const noteBoundedArguments = (call: BaseNode): void => {
    for (const expression of argumentExpressions(call)) {
      if (expression.type !== 'Identifier') continue;
      const origin = aliases.resolveExpression(
        scopeAt(ctx, expression),
        expression as unknown as t.Expression,
      );
      if (origin !== null && !isComputedOrigin(origin)) {
        noteReceiverEffect(origin);
      }
    }
  };

  const body = childNode(helperNode, 'body') ?? helperNode;
  walkAst<BaseNode>(body, {
    enter(current) {
      const lexicalScope = scopeAt(ctx, current);
      if (current.type === 'VariableDeclarator') {
        const pattern = childNode(current, 'id');
        const initializer = childNode(current, 'init');
        if (pattern?.type !== 'Identifier' && initializer !== null) {
          for (const origin of aliases.referencedOrigins(
            lexicalScope,
            initializer as unknown as t.Expression,
          )) {
            noteReceiverEffect(origin);
          }
        }
        return;
      }

      if (current.type === 'AssignmentExpression') {
        const left = childNode(current, 'left');
        const right = childNode(current, 'right');
        const leftName = identifierName(left);
        if (leftName !== null) {
          if (locals.has(leftName)) {
            const rightName = identifierName(right);
            if (rightName !== null && right !== null) {
              const origin = aliases.resolveExpression(
                lexicalScope,
                right as unknown as t.Expression,
              );
              if (origin !== null) noteReceiverEffect(origin);
            }
          } else if (ctx.state.has(leftName)) {
            summary.writes.add(leftName);
          }
        } else if (left?.type === 'MemberExpression') {
          noteMemberWrite(current, left);
        } else if (right !== null) {
          for (const origin of aliases.referencedOrigins(
            lexicalScope,
            right as unknown as t.Expression,
          )) {
            noteReceiverEffect(origin);
          }
        }
        return;
      }

      if (current.type === 'UpdateExpression') {
        const argument = childNode(current, 'argument');
        const argumentName = identifierName(argument);
        if (argumentName !== null) {
          if (!locals.has(argumentName) && ctx.state.has(argumentName)) {
            summary.writes.add(argumentName);
          }
        } else if (argument?.type === 'MemberExpression') {
          noteMemberWrite(current, argument);
        }
        return;
      }

      if (
        current.type === 'UnaryExpression' &&
        fields(current).operator === 'delete'
      ) {
        const argument = childNode(current, 'argument');
        if (argument?.type === 'MemberExpression') {
          noteMemberWrite(current, argument);
        }
        return;
      }

      if (current.type === 'CallExpression') {
        const callee = childNode(current, 'callee');
        if (callee?.type === 'MemberExpression') {
          const method = memberName(callee as unknown as t.MemberExpression);
          const receiver = childNode(callee, 'object');
          if (
            method === 'assign' &&
            identifierName(receiver) === 'Object'
          ) {
            const args = childNodes(current, 'arguments');
            const targetArg = args[0];
            const target =
              targetArg === undefined
                ? null
                : aliases.resolveExpression(
                    lexicalScope,
                    targetArg as unknown as t.Expression,
                  );
            if (target !== null) {
              const keys = staticAssignedKeys(
                target,
                args.slice(1) as unknown as t.CallExpression['arguments'],
              );
              if (keys === null) {
                noteReceiverEffect(target);
              } else {
                for (const key of keys) noteOriginWrite({ ...target, key });
              }
            }
            return;
          }

          const origin =
            receiver === null
              ? null
              : aliases.resolveExpression(
                  lexicalScope,
                  receiver as unknown as t.Expression,
                );
          if (origin !== null) noteReceiverEffect(origin);
          else noteBoundedArguments(current);
          return;
        }

        const calleeName = identifierName(callee);
        if (
          calleeName !== null &&
          (ctx.helpers.has(calleeName) || ctx.importedFunctions.has(calleeName))
        ) {
          const nested =
            ctx.importedFunctions.get(calleeName) ??
            summarizeHelper(ctx, calleeName, visiting);
          for (const read of nested.reads) summary.reads.add(read);
          for (const write of nested.writes) summary.writes.add(write);
          for (const write of nested.boundedWrites) {
            summary.boundedWrites.add(write);
          }
          const args = childNodes(current, 'arguments');
          for (const effect of nested.parameterWrites) {
            const argument = args[effect.index];
            if (
              argument === undefined ||
              argument.type === 'SpreadElement' ||
              argument.type === 'ArgumentPlaceholder'
            ) {
              continue;
            }
            const origin = aliases.resolveExpression(
              lexicalScope,
              argument as unknown as t.Expression,
            );
            if (origin !== null) {
              noteReceiverEffect(extendOrigin(origin, effect.path));
            }
          }
          if (nested.unbounded) summary.unbounded = true;
          return;
        }
        noteBoundedArguments(current);
        return;
      }

      if (current.type === 'Identifier') {
        const identifier = identifierName(current)!;
        if (!ctx.state.has(identifier) || locals.has(identifier)) return;
        if (assignmentLeftIs(ctx, current, current)) return;
        summary.reads.add(identifier);
        return;
      }

      if (current.type === 'MemberExpression') {
        const key = storeReadKey(ctx, current);
        if (key !== null) summary.reads.add(key);
      }
    },
  });

  visiting.delete(name);
  ctx.helperSummaries.set(name, summary);
  return summary;
}

function storeReadKey(ctx: Ctx, member: BaseNode): string | null {
  const key = memberKey(member as unknown as t.MemberExpression);
  if (!key || !key.includes('.')) return null;
  const root = key.split('.')[0]!;
  if (ctx.state.get(root) !== 'store') return null;
  if (astBindingAt(ctx, member, root)?.scope.isProgramScope !== true) {
    return null;
  }
  if (assignmentLeftIs(ctx, member, member)) return null;
  const parent = ctx.astAnalysis?.parentByNode.get(member) ?? null;
  if (parent?.type === 'CallExpression' && childNode(parent, 'callee') === member) {
    return null;
  }
  return key;
}

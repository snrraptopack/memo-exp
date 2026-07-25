/**
 * lifecycle.ts - explicit cleanup lowering and factory callback ownership.
 *
 * Source `cleanup(disposer)` is restricted to direct component-factory
 * execution and lowered with the generated entity id. Callback analysis is
 * deliberately API-agnostic: any function passed from factory setup receives
 * its own normal-exit invalidation when it writes reactive state.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx, type Ctx, type RowCtx } from './context';
import {
  instrumentComponentCallback,
  instrumentSharedCallback,
  resolveLocalHelper,
  type HandlerFn,
} from './handlers';
import { md } from './identifiers';

function functionFromBinding(bindingPath: NodePath): HandlerFn | null {
  if (bindingPath.isFunctionDeclaration()) return bindingPath.node;
  if (!bindingPath.isVariableDeclarator()) return null;
  const init = bindingPath.node.init;
  return init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
    ? init
    : null;
}

function instrumentIdentifier(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  name: string,
  compName: string,
  rowCtx?: RowCtx,
): void {
  const local = resolveLocalHelper(compPath, name);
  if (local !== null) {
    instrumentComponentCallback(ctx, compPath, local, compName, rowCtx);
    return;
  }

  const binding = compPath.scope.getBinding(name);
  if (
    binding === undefined ||
    binding.scope.path.isProgram() !== true ||
    !ctx.helpers.has(name)
  ) {
    return;
  }
  const shared = functionFromBinding(binding.path);
  if (shared !== null) instrumentSharedCallback(ctx, shared);
}

function instrumentArgument(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  argument: t.CallExpression['arguments'][number],
  compName: string,
  rowCtx?: RowCtx,
): void {
  if (t.isArrowFunctionExpression(argument) || t.isFunctionExpression(argument)) {
    if (nodeHasJsx(argument.body)) return;
    instrumentComponentCallback(ctx, compPath, argument, compName, rowCtx);
  } else if (t.isIdentifier(argument)) {
    instrumentIdentifier(ctx, compPath, argument.name, compName, rowCtx);
  }
}

function instrumentSharedIdentifier(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
  name: string,
): void {
  const binding = programPath.scope.getBinding(name);
  if (
    binding === undefined ||
    binding.scope.path.isProgram() !== true ||
    !ctx.helpers.has(name)
  ) {
    return;
  }
  const shared = functionFromBinding(binding.path);
  if (shared !== null) instrumentSharedCallback(ctx, shared);
}

function instrumentSharedArgument(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
  argument: t.CallExpression['arguments'][number],
): void {
  if (t.isArrowFunctionExpression(argument) || t.isFunctionExpression(argument)) {
    if (nodeHasJsx(argument.body)) return;
    instrumentSharedCallback(ctx, argument);
  } else if (t.isIdentifier(argument)) {
    instrumentSharedIdentifier(ctx, programPath, argument.name);
  }
}

/**
 * Lower direct cleanup registrations and instrument callbacks retained by
 * setup calls. Callback liveness is automatic; cancellation remains explicit.
 */
export function transformComponentLifecycle(
  ctx: Ctx,
  compPath: NodePath<t.FunctionDeclaration>,
  compName: string,
  factoryId: string,
  rowCtx?: RowCtx,
): void {
  compPath.traverse({
    CallExpression(call) {
      const directFactoryCall = call.getFunctionParent() === compPath;
      const originalCallee = call.node.callee;

      if (
        t.isIdentifier(originalCallee, { name: 'cleanup' }) &&
        call.scope.getBinding('cleanup') === undefined
      ) {
        if (!directFactoryCall) {
          throw call.buildCodeFrameError(
            'memo-dom: cleanup(disposer) must run directly during component factory initialization',
          );
        }
        const disposer = call.node.arguments[0];
        if (
          call.node.arguments.length !== 1 ||
          disposer === undefined ||
          !t.isExpression(disposer)
        ) {
          throw call.buildCodeFrameError(
            'memo-dom: cleanup(disposer) requires exactly one disposer expression',
          );
        }
        call.node.callee = md(ctx, 'cleanup');
        call.node.arguments.unshift(t.identifier(factoryId));
      }

      if (!directFactoryCall) return;
      if (t.isIdentifier(originalCallee)) {
        instrumentIdentifier(
          ctx,
          compPath,
          originalCallee.name,
          compName,
          rowCtx,
        );
      }
      for (const argument of call.node.arguments) {
        instrumentArgument(ctx, compPath, argument, compName, rowCtx);
      }
    },
    NewExpression(call) {
      if (call.getFunctionParent() !== compPath) return;
      for (const argument of call.node.arguments) {
        instrumentArgument(ctx, compPath, argument, compName, rowCtx);
      }
    },
  });
}

/**
 * Instrument callbacks retained by module initialization. They have no
 * component owner, so writes route through canonical access-table keys.
 */
export function transformProgramCallbacks(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  programPath.traverse({
    CallExpression(call) {
      if (call.getFunctionParent() !== null) return;
      if (t.isIdentifier(call.node.callee)) {
        instrumentSharedIdentifier(
          ctx,
          programPath,
          call.node.callee.name,
        );
      }
      for (const argument of call.node.arguments) {
        instrumentSharedArgument(ctx, programPath, argument);
      }
    },
    NewExpression(call) {
      if (call.getFunctionParent() !== null) return;
      for (const argument of call.node.arguments) {
        instrumentSharedArgument(ctx, programPath, argument);
      }
    },
  });
}

/** Reject cleanup syntax outside a component instead of leaving a runtime trap. */
export function rejectUnownedCleanup(programPath: NodePath<t.Program>): void {
  programPath.traverse({
    CallExpression(call) {
      if (
        t.isIdentifier(call.node.callee, { name: 'cleanup' }) &&
        call.scope.getBinding('cleanup') === undefined
      ) {
        throw call.buildCodeFrameError(
          'memo-dom: cleanup(disposer) is only valid directly inside a component factory',
        );
      }
    },
  });
}

/**
 * lifecycle.ts - explicit cleanup lowering and factory callback ownership.
 *
 * Source `$cleanup(disposer)` is restricted to direct component-factory
 * execution and lowered with the generated entity id. Callback analysis is
 * deliberately API-agnostic: any function passed from factory setup receives
 * its own normal-exit invalidation when it writes reactive state.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  walkAst,
  type BaseNode,
} from './ast';
import { astBindingAt, nodeHasJsx, type ComponentPath, type RowCtx } from './context';
import { type DomContext as Ctx } from './dom/context';
import { extractPatternIdentifiers } from './ast';
import {
  instrumentSharedCallback,
} from './dom/handlers';
import type {ComponentCallbacks} from './planning/component-callbacks';
import { emitComponentCallback } from './dom/component-callback';
import { md } from './dom/identifiers';
import { isIntrinsicLifecycleCall } from './intrinsics';

interface ProgramContainer {
  node: t.Program;
  buildCodeFrameError(message: string): Error;
}

function declarationIntroduces(
  declaration: t.VariableDeclaration,
  names: ReadonlySet<string>,
): boolean {
  return declaration.declarations.some((declarator) =>
    extractPatternIdentifiers(declarator.id as unknown as BaseNode).some(
      (identifier) => names.has(identifier.name),
    ),
  );
}

function instrumentIdentifier(
  ctx: Ctx,
  compPath: ComponentPath,
  name: string,
  callbacks: ComponentCallbacks,
  rowCtx?: RowCtx,
  executionAwareRoot = false,
): void {
  const local = callbacks.forValue(astFactory.identifier(name),executionAwareRoot);
  if (local !== null) {
    emitComponentCallback(ctx,local,rowCtx);
    return;
  }

  const binding = astBindingAt(
    ctx,
    compPath.node as unknown as BaseNode,
    name,
  );
  if (
    binding === undefined ||
    !binding.scope.isProgramScope ||
    !ctx.helpers.has(name)
  ) {
    return;
  }
  const shared = ctx.helpers.get(name)?.node;
  if (shared !== undefined) instrumentSharedCallback(ctx, shared, executionAwareRoot);
}

function instrumentArgument(
  ctx: Ctx,
  compPath: ComponentPath,
  argument: t.CallExpression['arguments'][number],
  callbacks: ComponentCallbacks,
  rowCtx?: RowCtx,
  executionAwareRoot = false,
): void {
  if (ctx.compilerOwnedCallbacks.has(argument as t.Node)) return;
  if (astFactory.isArrowFunctionExpression(argument) || astFactory.isFunctionExpression(argument)) {
    if (nodeHasJsx(argument.body)) return;
    emitComponentCallback(ctx,callbacks.forValue(argument,executionAwareRoot),rowCtx);
  } else if (astFactory.isObjectExpression(argument)) {
    for (const property of argument.properties) {
      if (astFactory.isSpreadElement(property)) {
        if (astFactory.isExpression(property.argument)) {
          instrumentArgument(ctx, compPath, property.argument, callbacks, rowCtx, executionAwareRoot);
        }
      } else if (
        astFactory.isObjectProperty(property) &&
        astFactory.isExpression(property.value)
      ) {
        instrumentArgument(ctx, compPath, property.value, callbacks, rowCtx, executionAwareRoot);
      }
    }
  } else if (astFactory.isArrayExpression(argument)) {
    for (const element of argument.elements) {
      if (element !== null) {
        instrumentArgument(ctx, compPath, element, callbacks, rowCtx, executionAwareRoot);
      }
    }
  } else if (astFactory.isIdentifier(argument)) {
    instrumentIdentifier(
      ctx,
      compPath,
      argument.name,
      callbacks,
      rowCtx,
      executionAwareRoot,
    );
  }
}

function instrumentSharedIdentifier(
  ctx: Ctx,
  programPath: ProgramContainer,
  name: string,
  executionAwareRoot = false,
): void {
  const binding = astBindingAt(
    ctx,
    programPath.node as unknown as BaseNode,
    name,
  );
  if (
    binding === undefined ||
    !binding.scope.isProgramScope ||
    !ctx.helpers.has(name)
  ) {
    return;
  }
  const shared = ctx.helpers.get(name)?.node;
  if (shared !== undefined) instrumentSharedCallback(ctx, shared, executionAwareRoot);
}

function instrumentSharedArgument(
  ctx: Ctx,
  programPath: ProgramContainer,
  argument: t.CallExpression['arguments'][number],
  executionAwareRoot = false,
): void {
  if (ctx.compilerOwnedCallbacks.has(argument as t.Node)) return;
  if (astFactory.isArrowFunctionExpression(argument) || astFactory.isFunctionExpression(argument)) {
    if (nodeHasJsx(argument.body)) return;
    instrumentSharedCallback(ctx, argument, executionAwareRoot);
  } else if (astFactory.isObjectExpression(argument)) {
    for (const property of argument.properties) {
      if (astFactory.isSpreadElement(property)) {
        if (astFactory.isExpression(property.argument)) {
          instrumentSharedArgument(ctx, programPath, property.argument, executionAwareRoot);
        }
      } else if (
        astFactory.isObjectProperty(property) &&
        astFactory.isExpression(property.value)
      ) {
        instrumentSharedArgument(ctx, programPath, property.value, executionAwareRoot);
      }
    }
  } else if (astFactory.isArrayExpression(argument)) {
    for (const element of argument.elements) {
      if (element !== null) {
        instrumentSharedArgument(ctx, programPath, element, executionAwareRoot);
      }
    }
  } else if (astFactory.isIdentifier(argument)) {
    instrumentSharedIdentifier(
      ctx,
      programPath,
      argument.name,
      executionAwareRoot,
    );
  }
}

/**
 * Lower direct cleanup registrations and instrument callbacks retained by
 * setup calls. Callback liveness is automatic; cancellation remains explicit.
 */
export function transformComponentLifecycle(
  ctx: Ctx,
  compPath: ComponentPath,
  compName: string,
  factoryId: string,
  callbacks: ComponentCallbacks,
  rowCtx?: RowCtx,
): void {
  let functionDepth = 0;
  let derivationDepth = 0;
  const derivedBindings = ctx.instanceDerivedBindings.get(compName) ?? new Set();
  walkAst<BaseNode>(compPath.node.body, {
    enter(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        // JSX is synchronous render input, not component-setup lifecycle.
        // Structural expressions, native handlers, and component callback
        // props are each lowered by their dedicated emitters. Walking into
        // the tree here can mistake a read-only callback in a compiler-
        // expanded condition/list (for example `items.filter(...)`) for a
        // retained setup callback and publish a false mutation on every
        // render. Keep this boundary syntax-driven: no event or method-name
        // allowlist is involved.
        return false;
      }
      if (
        node.type === 'VariableDeclaration' &&
        declarationIntroduces(
          node as unknown as t.VariableDeclaration,
          derivedBindings,
        )
      ) {
        derivationDepth++;
      }
      if (FUNCTION_NODES.has(node.type)) {
        functionDepth++;
        return;
      }
      if (node.type === 'CallExpression') {
        const call = node as unknown as t.CallExpression;
        const directFactoryCall = functionDepth === 0;
        if (directFactoryCall && derivationDepth > 0) return false;
        const originalCallee = call.callee;
        const intrinsicEffect = isIntrinsicLifecycleCall(ctx, node, 'effect');

        if (
          isIntrinsicLifecycleCall(ctx, node, 'cleanup')
        ) {
          if (!directFactoryCall) {
            throw compPath.buildCodeFrameError(
              'memo-dom: $cleanup(disposer) must run directly during component factory initialization',
            );
          }
          const disposer = call.arguments[0];
          if (
            call.arguments.length !== 1 ||
            disposer === undefined ||
            !astFactory.isExpression(disposer)
          ) {
            throw compPath.buildCodeFrameError(
              'memo-dom: $cleanup(disposer) requires exactly one disposer expression',
            );
          }
          call.callee = md(ctx, 'cleanup');
          call.arguments.unshift(astFactory.identifier(factoryId));
        }

        if (!directFactoryCall) return;
        if (astFactory.isIdentifier(originalCallee)) {
          instrumentIdentifier(
            ctx,
            compPath,
            originalCallee.name,
            callbacks,
            rowCtx,
          );
        }
        for (const argument of call.arguments) {
          instrumentArgument(
            ctx,
            compPath,
            argument,
            callbacks,
            rowCtx,
            intrinsicEffect,
          );
        }
        return;
      }
      if (node.type === 'NewExpression' && functionDepth === 0) {
        if (derivationDepth > 0) return false;
        const call = node as unknown as t.NewExpression;
        for (const argument of call.arguments) {
          instrumentArgument(ctx, compPath, argument, callbacks, rowCtx);
        }
      }
    },
    leave(node) {
      if (FUNCTION_NODES.has(node.type)) functionDepth--;
      if (
        node.type === 'VariableDeclaration' &&
        declarationIntroduces(
          node as unknown as t.VariableDeclaration,
          derivedBindings,
        )
      ) {
        derivationDepth--;
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
  programPath: ProgramContainer,
): void {
  let functionDepth = 0;
  walkAst<BaseNode>(programPath.node, {
    enter(node) {
      if (FUNCTION_NODES.has(node.type)) {
        functionDepth++;
        return;
      }
      if (node.type === 'CallExpression' && functionDepth === 0) {
        const call = node as unknown as t.CallExpression;
        const intrinsicEffect = isIntrinsicLifecycleCall(ctx, node, 'effect');
        if (astFactory.isIdentifier(call.callee)) {
          instrumentSharedIdentifier(
            ctx,
            programPath,
            call.callee.name,
          );
        }
        for (const argument of call.arguments) {
          instrumentSharedArgument(
            ctx,
            programPath,
            argument,
            intrinsicEffect,
          );
        }
        return;
      }
      if (node.type === 'NewExpression' && functionDepth === 0) {
        const call = node as unknown as t.NewExpression;
        for (const argument of call.arguments) {
          instrumentSharedArgument(ctx, programPath, argument);
        }
      }
    },
    leave(node) {
      if (FUNCTION_NODES.has(node.type)) functionDepth--;
    },
  });
}

/**
 * Instrument work that escapes a module helper's synchronous call.
 *
 * Async helpers own their normal-completion commit because callers cannot
 * represent writes after an `await`. Synchronous helpers remain caller-
 * committed, but function arguments created in their direct body can be
 * retained by any API and must publish their own later writes. This is based
 * on callback syntax and lexical ownership, never an API-name allowlist.
 */
export function transformSharedHelperCallbacks(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  for (const helper of ctx.helpers.values()) {
    if (helper.node.async) {
      instrumentSharedCallback(ctx, helper.node);
      continue;
    }

    let functionDepth = 0;
    walkAst<BaseNode>(helper.node.body, {
      enter(node) {
        if (FUNCTION_NODES.has(node.type)) {
          functionDepth++;
          return;
        }
        if (node.type === 'CallExpression' && functionDepth === 0) {
          const call = node as unknown as t.CallExpression;
          for (const argument of call.arguments) {
            instrumentSharedArgument(ctx, programPath, argument);
          }
          return;
        }
        if (node.type === 'NewExpression' && functionDepth === 0) {
          const call = node as unknown as t.NewExpression;
          for (const argument of call.arguments) {
            instrumentSharedArgument(ctx, programPath, argument);
          }
        }
      },
      leave(node) {
        if (FUNCTION_NODES.has(node.type)) functionDepth--;
      },
    });
  }
}

/** Reject cleanup syntax outside a component instead of leaving a runtime trap. */
export function rejectUnownedCleanup(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  walkAst<BaseNode>(programPath.node, {
    enter(node) {
      if (node.type !== 'CallExpression') return;
      if (
        isIntrinsicLifecycleCall(ctx, node, 'cleanup')
      ) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $cleanup(disposer) is only valid directly inside a component factory',
        );
      }
    },
  });
}

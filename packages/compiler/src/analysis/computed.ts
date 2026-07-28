import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  memberRootName,
  registerState,
  walkNodes,
  type ComputedAnalysis,
  type Ctx,
} from '../context';
import { summarizeHelper } from '../helper-summaries';

/**
 * Analyze a candidate module-level computed initializer. Detection is by
 * reactive-state reference rather than by a whitelist of expression forms.
 */
export function analyzeComputed(ctx: Ctx, expr: t.Node): ComputedAnalysis {
  const reads = new Set<string>();
  let impure = false;
  let reason: string | undefined;
  const locals = new Set<string>();
  const fail = (message: string): void => {
    if (!impure) {
      impure = true;
      reason = message;
    }
  };
  const noteLocalPattern = (id: t.LVal): void => {
    if (t.isIdentifier(id)) locals.add(id.name);
    else {
      walkNodes(id, (node) => {
        if (t.isIdentifier(node)) locals.add(node.name);
      });
    }
  };

  walkNodes(expr, (node, parent) => {
    if (t.isFunction(node)) {
      const executesAsPartOfExpression =
        parent !== null &&
        (t.isCallExpression(parent) || t.isNewExpression(parent));
      if (!executesAsPartOfExpression) return false;
      for (const param of node.params) {
        if (t.isLVal(param)) noteLocalPattern(param);
      }
      return;
    }
    if (t.isVariableDeclarator(node) && t.isLVal(node.id)) {
      noteLocalPattern(node.id);
      return;
    }
    if (t.isAssignmentExpression(node)) {
      const root = t.isIdentifier(node.left)
        ? node.left.name
        : t.isMemberExpression(node.left)
          ? memberRootName(node.left)
          : null;
      if (root === null || !locals.has(root)) {
        fail('contains an assignment — writes belong in handlers, not derivations');
      }
      return;
    }
    if (t.isUpdateExpression(node)) {
      const argument = node.argument;
      const root = t.isIdentifier(argument)
        ? argument.name
        : t.isMemberExpression(argument)
          ? memberRootName(argument)
          : null;
      if (root === null || !locals.has(root)) {
        fail('contains an update (++/--) — writes belong in handlers, not derivations');
      }
      return;
    }
    if (t.isAwaitExpression(node) || t.isYieldExpression(node)) {
      fail('uses await/yield — derivations must be synchronous');
      return;
    }
    if (t.isCallExpression(node)) {
      const callee = node.callee;
      if (
        t.isIdentifier(callee) &&
        (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name))
      ) {
        const summary =
          ctx.importedFunctions.get(callee.name) ??
          summarizeHelper(ctx, callee.name);
        for (const read of summary.reads) reads.add(read);
        if (summary.writes.size > 0) {
          for (const write of summary.writes) reads.add(write);
          fail(
            `calls helper '${callee.name}' which writes state — writes belong in handlers`,
          );
        } else if (summary.unbounded && ctx.helpers.has(callee.name)) {
          fail(`calls recursive helper '${callee.name}' which cannot be analyzed`);
        }
      }
      return;
    }
    if (t.isIdentifier(node)) {
      if (!locals.has(node.name) && ctx.state.has(node.name)) {
        reads.add(node.name);
      }
      return;
    }
    if (t.isMemberExpression(node) && !node.computed) {
      const key = memberKey(node);
      if (key !== null && key.includes('.')) {
        const root = key.split('.')[0]!;
        if (!locals.has(root) && ctx.state.get(root) === 'store') {
          reads.add(key);
        }
      }
    }
  });

  return { reads, impure, reason };
}

/** Discover ordered module-level const derivations after module state exists. */
export function scanComputeds(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  for (const statement of programPath.node.body) {
    const inner = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!t.isVariableDeclaration(inner) || inner.kind !== 'const') continue;
    for (const declaration of inner.declarations) {
      if (!t.isIdentifier(declaration.id) || declaration.init == null) continue;
      const name = declaration.id.name;
      if (
        ctx.state.get(name) === 'let' ||
        ctx.state.get(name) === 'computed'
      ) {
        continue;
      }
      if (t.isFunction(declaration.init) || t.isJSX(declaration.init)) continue;
      const result = analyzeComputed(ctx, declaration.init);
      if (result.impure) {
        if (result.reads.size > 0) {
          throw new Error(
            `memo-dom: const '${name}' is a state derivation but ${
              result.reason ?? 'cannot be analyzed'
            }. Fix the derivation, or make it a 'let' you update in handlers.`,
          );
        }
        continue;
      }
      if (result.reads.size === 0) continue;
      registerState(ctx, name, 'computed');
      ctx.computeds.set(name, { reads: result.reads });
    }
  }
}

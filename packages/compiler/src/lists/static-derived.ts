/**
 * static-derived.ts - frozen derived values over static list literals.
 *
 * A `const` whose initializer is a static list expression (rooted at a
 * primitive array literal through self-contained transforms) is a FROZEN
 * derived value: it can never change, so any later mutation attempt is a
 * compile error - mutating it could never be observed by reactivity.
 *
 * Because the value never changes, the rule applies at module scope as well
 * as component scope.
 */
import * as t from '@babel/types';
import type { Ctx } from '../context';
import {
  isStaticListExpression,
  transparentListExpression,
} from './source-shapes';

/** Remove transparent TypeScript wrappers around an expression. */
function unwrap(expression: t.Expression): t.Expression {
  return transparentListExpression(expression);
}

/**
 * Find the initializer of a `const` binding declared at module scope or in
 * the component body.
 */
export function findConstInitializer(
  ctx: Ctx,
  name: string,
  compName?: string | null,
): t.Expression | null {
  const scopes: t.Statement[] = [];
  const componentPath =
    compName !== undefined && compName !== null
      ? ctx.compPaths.get(compName)
      : undefined;
  if (componentPath !== undefined) {
    // getProgramParent's path is typed as Program - no narrowing dance.
    const programPath = componentPath.scope.getProgramParent().path;
    scopes.push(...(programPath.node as t.Program).body);
    scopes.push(...componentPath.node.body.body);
  }
  for (const stmt of scopes) {
    if (!t.isVariableDeclaration(stmt)) continue;
    for (const declarator of stmt.declarations) {
      if (
        t.isIdentifier(declarator.id) &&
        declarator.id.name === name &&
        declarator.init !== null &&
        t.isExpression(declarator.init)
      ) {
        return unwrap(declarator.init);
      }
    }
  }
  return null;
}

/**
 * True when the initializer is a DERIVED chain: at least one method transform
 * applied to a primitive array literal root (`[...].filter(fn)`). A plain
 * array literal (`[...]`) is NOT derived - it is ordinary reactive state.
 */
export function isStaticDerivedChain(
  expression: t.Expression,
): boolean {
  const current = transparentListExpression(expression);
  if (
    !t.isCallExpression(current) ||
    !t.isMemberExpression(current.callee)
  ) {
    return false;
  }
  // The root below the outermost transform must be a static list.
  return isStaticListExpression(current.callee.object as t.Expression);
}

/**
 * True when `name` is bound to a static-derived value: a method chain rooted
 * at a primitive array literal. The DECLARATION KEYWORD is irrelevant -
 * `let arr = [...].filter(fn)` is exactly as frozen as the const form,
 * because the initializer derives from a static source that can never
 * change. Mutation attempts on such bindings are compile errors.
 *
 * Reactive machinery keeps priority for everything else: plain array
 * literals remain reactive state, and state-derived/prop/opaque bindings
 * follow their own rules.
 */
export function isStaticDerivedListConst(
  ctx: Ctx,
  name: string,
  compName?: string | null,
): boolean {
  const init = findConstInitializer(ctx, name, compName);
  if (init === null) return false;
  return isStaticDerivedChain(init);
}

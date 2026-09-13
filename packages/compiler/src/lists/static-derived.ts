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
import {
  childNode,
  childNodes,
  nodeField as field,
  type BaseNode,
} from '../ast';
import type { Ctx } from '../context';
import {
  isStaticListExpression,
  transparentListExpression,
} from './source-shapes';

/**
 * Find the initializer of a binding declared at module scope or in the
 * component body.
 */
export function findConstInitializer(
  ctx: Ctx,
  name: string,
  compName?: string | null,
): BaseNode | null {
  const scopes: BaseNode[] = [];
  const componentPath =
    compName !== undefined && compName !== null
      ? ctx.compPaths.get(compName)
      : undefined;
  if (componentPath !== undefined) {
    const program = ctx.astAnalysis?.rootScope.block;
    if (program?.type === 'Program') {
      scopes.push(...childNodes(program, 'body'));
    }
    scopes.push(...childNodes(componentPath.node.body, 'body'));
  }
  for (const statement of scopes) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declarator of childNodes(statement, 'declarations')) {
      const id = childNode(declarator, 'id');
      const init = childNode(declarator, 'init');
      if (
        id?.type === 'Identifier' &&
        field(id, 'name') === name &&
        init !== null
      ) {
        return transparentListExpression(init);
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
export function isStaticDerivedChain(expression: BaseNode): boolean {
  const current = transparentListExpression(expression);
  if (current.type !== 'CallExpression') return false;
  const callee = childNode(current, 'callee');
  if (callee?.type !== 'MemberExpression') return false;
  const source = childNode(callee, 'object');
  return source !== null && isStaticListExpression(source);
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

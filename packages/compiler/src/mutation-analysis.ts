/**
 * mutation-analysis.ts - shared provenance helpers for conservative writes.
 *
 * Tracks local aliases back to reactive roots using lexical binding identity.
 * Consumers decide whether a resolved origin permits a precise write key or
 * whether reassignment/destructuring requires a root-subtree fallback.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { walkAst } from './ast';
import { memberKey, type StateKind } from './context';

export type ReactiveLocality = 'module' | 'instance' | 'row' | 'prop';

export interface ReactiveOrigin {
  locality: ReactiveLocality;
  /** Original binding name, before any aliases. */
  root: string;
  /** Static path rooted at `root`, or null after a dynamic member access. */
  key: string | null;
  stateKind?: StateKind;
}

type OriginFallback = (
  name: string,
  binding: BindingLike | undefined,
) => ReactiveOrigin | null;

/** Minimal parser-neutral binding contract needed by alias analysis. */
export interface BindingLike {
  identifier: object;
  scope: ScopeLike;
}

/** Parser adapters and compiler ESTree scopes can satisfy this contract. */
export interface ScopeLike {
  block: object;
  isProgramScope?: boolean;
  path?: { isProgram(): boolean };
  getBinding(name: string): BindingLike | undefined;
}

export function bindingScopeIsProgram(binding: BindingLike): boolean {
  return (
    binding.scope.isProgramScope === true ||
    binding.scope.path?.isProgram() === true
  );
}

export class AliasTracker {
  private readonly origins = new WeakMap<object, ReactiveOrigin>();

  constructor(private readonly fallback: OriginFallback) {}

  trackDeclarator(
    scope: ScopeLike,
    declarator: t.VariableDeclarator,
  ): void {
    if (
      !astFactory.isIdentifier(declarator.id) ||
      declarator.init === null
    ) {
      return;
    }
    const origin = this.resolveExpression(scope, declarator.init as t.Expression);
    if (origin === null) return;
    const binding = scope.getBinding(declarator.id.name);
    if (binding !== undefined) this.origins.set(binding.identifier, origin);
  }

  /**
   * Find reactive values mentioned inside an expression when its resulting
   * provenance cannot be represented as one exact origin (for example a
   * conditional alias or destructuring source).
   */
  referencedOrigins(scope: ScopeLike, node: t.Node): ReactiveOrigin[] {
    const origins = new Map<string, ReactiveOrigin>();
    walkAst(node, {
      enter: (current) => {
        if (!astFactory.isIdentifier(current) && !astFactory.isMemberExpression(current)) {
          return undefined;
        }
        const origin = this.resolveExpression(scope, current);
        if (origin !== null) {
          const identity = [
            origin.locality,
            origin.root,
            origin.key ?? '*',
          ].join(':');
          origins.set(identity, origin);
          return false;
        }
        return undefined;
      },
    });
    return [...origins.values()];
  }

  resolveName(scope: ScopeLike, name: string): ReactiveOrigin | null {
    const binding = scope.getBinding(name);
    if (binding !== undefined) {
      const tracked = this.origins.get(binding.identifier);
      if (tracked !== undefined) return tracked;
    }
    return this.fallback(name, binding);
  }

  resolveExpression(scope: ScopeLike, raw: t.Node): ReactiveOrigin | null {
    const expression = unwrapExpression(raw);
    if (
      astFactory.isCallExpression(expression) &&
      astFactory.isMemberExpression(expression.callee) &&
      astFactory.isIdentifier(expression.callee.property) &&
      (expression.callee.property.name === 'readResolvedValue' ||
       expression.callee.property.name === 'readResolvedValueForRender' ||
       expression.callee.property.name === 'readModuleSourceList')
    ) {
      const secondArg = expression.arguments[1];
      if (astFactory.isStringLiteral(secondArg)) {
        return this.resolveName(scope, secondArg.value);
      }
      const firstArg = expression.arguments[0];
      if (astFactory.isIdentifier(firstArg)) {
        return this.resolveName(scope, firstArg.name);
      }
    }
    if (astFactory.isIdentifier(expression)) {
      return this.resolveName(scope, expression.name);
    }
    if (!astFactory.isMemberExpression(expression)) return null;

    const root = memberRoot(expression);
    if (root === null) return null;
    const origin = this.resolveName(scope, root);
    if (origin === null) return null;
    const key = memberKey(expression);
    if (origin.key === null || key === null) return { ...origin, key: null };

    const relative = key.split('.').slice(1);
    return {
      ...origin,
      key: [origin.key, ...relative].join('.'),
    };
  }
}

export function moduleOrigin(
  name: string,
  stateKind: StateKind,
): ReactiveOrigin {
  return {
    locality: 'module',
    root: name,
    key: name,
    stateKind,
  };
}

/** Append a helper-summary path to an argument's resolved reactive origin. */
export function extendOrigin(
  origin: ReactiveOrigin,
  relativePath: readonly string[],
): ReactiveOrigin {
  if (origin.key === null) return origin;
  return {
    ...origin,
    key: [origin.key, ...relativePath].join('.'),
  };
}

export function staticAssignedKeys(
  target: ReactiveOrigin,
  sources: readonly (t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder)[],
): string[] | null {
  if (target.key === null) return null;
  const keys: string[] = [];
  for (const source of sources) {
    if (!astFactory.isObjectExpression(source)) return null;
    for (const property of source.properties) {
      if (
        !astFactory.isObjectProperty(property) ||
        property.computed ||
        (!astFactory.isIdentifier(property.key) && !astFactory.isStringLiteral(property.key))
      ) {
        return null;
      }
      const name = astFactory.isIdentifier(property.key)
        ? property.key.name
        : property.key.value;
      keys.push(`${target.key}.${name}`);
    }
  }
  return keys;
}

export function callArgumentExpressions(
  args: readonly (t.Expression | t.SpreadElement | t.JSXNamespacedName | t.ArgumentPlaceholder)[],
): t.Expression[] {
  const out: t.Expression[] = [];
  for (const arg of args) {
    if (astFactory.isExpression(arg)) out.push(arg);
    else if (astFactory.isSpreadElement(arg)) out.push(arg.argument);
  }
  return out;
}

export function memberName(node: t.MemberExpression): string | null {
  if (!node.computed && astFactory.isIdentifier(node.property)) return node.property.name;
  if (node.computed && astFactory.isStringLiteral(node.property)) return node.property.value;
  return null;
}

function memberRoot(node: t.MemberExpression): string | null {
  let current: t.Expression = node;
  while (astFactory.isMemberExpression(current)) {
    if (astFactory.isSuper(current.object)) return null;
    current = unwrapExpression(current.object);
  }
  return astFactory.isIdentifier(current) ? current.name : null;
}

function unwrapExpression(node: t.Node): t.Expression {
  let current = node;
  while (
    astFactory.isTSAsExpression(current) ||
    astFactory.isTSTypeAssertion(current) ||
    astFactory.isTSNonNullExpression(current) ||
    astFactory.isTypeCastExpression(current) ||
    astFactory.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current as t.Expression;
}

/**
 * mutation-analysis.ts - shared provenance helpers for conservative writes.
 *
 * Tracks local aliases back to reactive roots using Babel binding identity.
 * Consumers decide whether a resolved origin permits a precise write key or
 * whether reassignment/destructuring requires a root-subtree fallback.
 */

import type { Binding, Scope } from '@babel/traverse';
import * as t from '@babel/types';
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
  binding: Binding | undefined,
) => ReactiveOrigin | null;

export class AliasTracker {
  private readonly origins = new WeakMap<t.Identifier, ReactiveOrigin>();

  constructor(private readonly fallback: OriginFallback) {}

  trackDeclarator(
    scope: Scope,
    declarator: t.VariableDeclarator,
  ): void {
    if (
      !t.isIdentifier(declarator.id) ||
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
  referencedOrigins(scope: Scope, node: t.Node): ReactiveOrigin[] {
    const origins = new Map<string, ReactiveOrigin>();
    const visit = (current: t.Node): void => {
      if (t.isIdentifier(current) || t.isMemberExpression(current)) {
        const origin = this.resolveExpression(scope, current);
        if (origin !== null) {
          const identity = [
            origin.locality,
            origin.root,
            origin.key ?? '*',
          ].join(':');
          origins.set(identity, origin);
          return;
        }
      }
      for (const key of t.VISITOR_KEYS[current.type] ?? []) {
        const child = (current as any)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && 'type' in item) visit(item);
          }
        } else if (child && typeof child === 'object' && 'type' in child) {
          visit(child);
        }
      }
    };
    visit(node);
    return [...origins.values()];
  }

  resolveName(scope: Scope, name: string): ReactiveOrigin | null {
    const binding = scope.getBinding(name);
    if (binding !== undefined) {
      const tracked = this.origins.get(binding.identifier);
      if (tracked !== undefined) return tracked;
    }
    return this.fallback(name, binding);
  }

  resolveExpression(scope: Scope, raw: t.Node): ReactiveOrigin | null {
    const expression = unwrapExpression(raw);
    if (t.isIdentifier(expression)) {
      return this.resolveName(scope, expression.name);
    }
    if (!t.isMemberExpression(expression)) return null;

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
    if (!t.isObjectExpression(source)) return null;
    for (const property of source.properties) {
      if (
        !t.isObjectProperty(property) ||
        property.computed ||
        (!t.isIdentifier(property.key) && !t.isStringLiteral(property.key))
      ) {
        return null;
      }
      const name = t.isIdentifier(property.key)
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
    if (t.isExpression(arg)) out.push(arg);
    else if (t.isSpreadElement(arg)) out.push(arg.argument);
  }
  return out;
}

export function memberName(node: t.MemberExpression): string | null {
  if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
  if (node.computed && t.isStringLiteral(node.property)) return node.property.value;
  return null;
}

function memberRoot(node: t.MemberExpression): string | null {
  let current: t.Expression = node;
  while (t.isMemberExpression(current)) {
    if (t.isSuper(current.object)) return null;
    current = unwrapExpression(current.object);
  }
  return t.isIdentifier(current) ? current.name : null;
}

function unwrapExpression(node: t.Node): t.Expression {
  let current = node;
  while (
    t.isTSAsExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current) ||
    t.isTypeCastExpression(current) ||
    t.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current as t.Expression;
}

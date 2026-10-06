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
import { asyncReadFact } from './planning/async-reads';

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
  private readonly namedOrigins = new Map<string, ReactiveOrigin[]>();
  private readonly memberOrigins = new Map<string, ReactiveOrigin[]>();

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

  /** Seed declarations outside a detached handler's lexical scope. */
  trackNamed(name: string, origins: ReactiveOrigin[]): void {
    if (origins.length > 0) this.namedOrigins.set(name, origins);
  }

  trackBinding(scope: ScopeLike, name: string, origins: ReactiveOrigin[]): void {
    const binding = scope.getBinding(name);
    if (binding !== undefined && origins.length === 1) {
      this.origins.set(binding.identifier, origins[0]!);
    }
  }

  trackNamedMember(key: string, origins: ReactiveOrigin[]): void {
    if (origins.length > 0) this.memberOrigins.set(key, origins);
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
      if (!bindingScopeIsProgram(binding)) return this.fallback(name, binding);
    }
    const named = this.namedOrigins.get(name);
    if (named !== undefined) return named.length === 1 ? named[0]! : null;
    return this.fallback(name, binding);
  }

  resolveNameOrigins(scope: ScopeLike, name: string): ReactiveOrigin[] {
    const binding = scope.getBinding(name);
    if (binding !== undefined) {
      const tracked = this.origins.get(binding.identifier);
      if (tracked !== undefined) return [tracked];
      if (!bindingScopeIsProgram(binding)) {
        const local = this.fallback(name, binding);
        return local === null ? [] : [local];
      }
    }
    const named = this.namedOrigins.get(name);
    if (named !== undefined) return named;
    const origin = this.fallback(name, binding);
    return origin === null ? [] : [origin];
  }

  resolveExpression(scope: ScopeLike, raw: t.Node): ReactiveOrigin | null {
    const expression = unwrapExpression(raw);
    const read = asyncReadFact(expression);
    if (read?.binding !== undefined && read.sources.length === 1) {
      return this.resolveName(scope, read.binding);
    }
    if (astFactory.isIdentifier(expression)) {
      return this.resolveName(scope, expression.name);
    }
    if (!astFactory.isMemberExpression(expression)) return null;

    const staticKey = memberKey(expression);
    if (staticKey !== null) {
      const seeded = this.memberOrigins.get(staticKey);
      if (seeded !== undefined) return seeded.length === 1 ? seeded[0]! : null;
    }
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

  resolveExpressionOrigins(scope: ScopeLike, raw: t.Node): ReactiveOrigin[] {
    const expression = unwrapExpression(raw);
    if (astFactory.isConditionalExpression(expression)) {
      return uniqueOrigins([
        ...this.resolveExpressionOrigins(scope, expression.consequent),
        ...this.resolveExpressionOrigins(scope, expression.alternate),
      ]);
    }
    if (astFactory.isIdentifier(expression)) {
      return this.resolveNameOrigins(scope, expression.name);
    }
    if (astFactory.isMemberExpression(expression)) {
      const key = memberKey(expression);
      const seeded = key === null ? undefined : this.memberOrigins.get(key);
      if (seeded !== undefined) return seeded;
      const root = memberRoot(expression);
      if (root !== null) {
        const bases = this.resolveNameOrigins(scope, root);
        const relative = key?.split('.').slice(1) ?? null;
        if (bases.length > 0) return uniqueOrigins(bases.map(origin => ({
          ...origin,
          key: origin.key === null || relative === null
            ? null
            : [origin.key, ...relative].join('.'),
        })));
      }
    }
    const origin = this.resolveExpression(scope, expression);
    return origin === null ? [] : [origin];
  }
}

function uniqueOrigins(origins: ReactiveOrigin[]): ReactiveOrigin[] {
  const seen = new Set<string>();
  return origins.filter(origin => {
    const key = `${origin.locality}:${origin.root}:${origin.key ?? '*'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function memberRoot(node: t.MemberExpression): string | null {
  let current: t.Expression = node;
  while (astFactory.isMemberExpression(current)) {
    if (astFactory.isSuper(current.object)) return null;
    current = unwrapExpression(current.object);
  }
  return astFactory.isIdentifier(current) ? current.name : null;
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

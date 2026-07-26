/**
 * Retains prop provenance through compiler-replayed body destructuring.
 */
import * as t from '@babel/types';
import {
  memberKey,
  memberRootName,
  type Ctx,
} from '../context';
import {
  extendOrigin,
  type ReactiveOrigin,
} from '../mutation-analysis';
import {
  objectBindingName,
  propNameForBinding,
} from './props';

type ProjectionTarget =
  | t.Identifier
  | t.ObjectPattern
  | t.ArrayPattern
  | t.AssignmentPattern
  | t.RestElement;

function isProjectionTarget(
  node: t.Node | null | undefined,
): node is ProjectionTarget {
  return (
    t.isIdentifier(node) ||
    t.isObjectPattern(node) ||
    t.isArrayPattern(node) ||
    t.isAssignmentPattern(node) ||
    t.isRestElement(node)
  );
}

function unwrap(node: t.Expression): t.Expression {
  let current = node;
  while (
    t.isTSAsExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current) ||
    t.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function bindPattern(
  origins: Map<string, ReactiveOrigin>,
  target: ProjectionTarget,
  origin: ReactiveOrigin,
): void {
  if (t.isIdentifier(target)) {
    origins.set(target.name, origin);
    return;
  }
  if (t.isAssignmentPattern(target)) {
    if (isProjectionTarget(target.left)) {
      bindPattern(origins, target.left, origin);
    }
    return;
  }
  if (t.isRestElement(target)) {
    return;
  }
  if (t.isArrayPattern(target)) {
    for (let index = 0; index < target.elements.length; index++) {
      const element = target.elements[index];
      if (isProjectionTarget(element)) {
        bindPattern(origins, element, extendOrigin(origin, [String(index)]));
      }
    }
    return;
  }
  if (!t.isObjectPattern(target)) return;
  for (const property of target.properties) {
    if (t.isRestElement(property)) {
      continue;
    }
    if (
      property.computed ||
      (!t.isIdentifier(property.key) &&
        !t.isStringLiteral(property.key) &&
        !t.isNumericLiteral(property.key))
    ) {
      if (isProjectionTarget(property.value)) {
        bindPattern(origins, property.value, {
          ...origin,
          key: null,
        });
      }
      continue;
    }
    const key = t.isIdentifier(property.key)
      ? property.key.name
      : String(property.key.value);
    if (isProjectionTarget(property.value)) {
      bindPattern(
        origins,
        property.value,
        extendOrigin(origin, [key]),
      );
    }
  }
}

function sourceOrigin(
  ctx: Ctx,
  component: string,
  origins: Map<string, ReactiveOrigin>,
  raw: t.Expression,
): ReactiveOrigin | null {
  const expression = unwrap(raw);
  const plan = ctx.componentProps.get(component);
  if (plan === undefined) return null;

  if (t.isIdentifier(expression)) {
    const projected = origins.get(expression.name);
    if (projected !== undefined) return projected;
    if (objectBindingName(plan) === expression.name) {
      return {
        locality: 'prop',
        root: expression.name,
        key: expression.name,
      };
    }
    const prop = propNameForBinding(plan, expression.name);
    return prop === null
      ? null
      : {
          locality: 'prop',
          root: expression.name,
          key: expression.name,
        };
  }
  if (!t.isMemberExpression(expression)) return null;
  const root = memberRootName(expression);
  const key = memberKey(expression);
  if (root === null) return null;
  const origin = sourceOrigin(
    ctx,
    component,
    origins,
    t.identifier(root),
  );
  if (origin === null) return null;
  return key === null
    ? { ...origin, key: null }
    : extendOrigin(origin, key.split('.').slice(1));
}

/** Body-projected bindings whose values still represent component props. */
export function componentPropProjectionOrigins(
  ctx: Ctx,
  component: string,
): Map<string, ReactiveOrigin> {
  const origins = new Map<string, ReactiveOrigin>();
  for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
    const origin = sourceOrigin(
      ctx,
      component,
      origins,
      derivation.source,
    );
    if (origin !== null) bindPattern(origins, derivation.target, origin);
  }
  return origins;
}

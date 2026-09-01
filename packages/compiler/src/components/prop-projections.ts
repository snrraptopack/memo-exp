/**
 * Retains prop provenance through compiler-replayed body destructuring.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
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
    astFactory.isIdentifier(node) ||
    astFactory.isObjectPattern(node) ||
    astFactory.isArrayPattern(node) ||
    astFactory.isAssignmentPattern(node) ||
    astFactory.isRestElement(node)
  );
}

function unwrap(node: t.Expression): t.Expression {
  let current: t.Node = node;
  while (
    astFactory.isTSAsExpression(current) ||
    astFactory.isTSTypeAssertion(current) ||
    astFactory.isTSNonNullExpression(current) ||
    astFactory.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current as t.Expression;
}

function bindPattern(
  origins: Map<string, ReactiveOrigin>,
  target: ProjectionTarget,
  origin: ReactiveOrigin,
): void {
  if (astFactory.isIdentifier(target)) {
    origins.set(target.name, origin);
    return;
  }
  if (astFactory.isAssignmentPattern(target)) {
    if (isProjectionTarget(target.left)) {
      bindPattern(origins, target.left, origin);
    }
    return;
  }
  if (astFactory.isRestElement(target)) {
    return;
  }
  if (astFactory.isArrayPattern(target)) {
    for (let index = 0; index < target.elements.length; index++) {
      const element = target.elements[index];
      if (isProjectionTarget(element)) {
        bindPattern(origins, element, extendOrigin(origin, [String(index)]));
      }
    }
    return;
  }
  if (!astFactory.isObjectPattern(target)) return;
  for (const property of target.properties) {
    if (astFactory.isRestElement(property)) {
      continue;
    }
    if (
      property.computed ||
      (!astFactory.isIdentifier(property.key) &&
        !astFactory.isStringLiteral(property.key) &&
        !astFactory.isNumericLiteral(property.key))
    ) {
      if (isProjectionTarget(property.value)) {
        bindPattern(origins, property.value, {
          ...origin,
          key: null,
        });
      }
      continue;
    }
    const key = astFactory.isIdentifier(property.key)
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

  if (astFactory.isIdentifier(expression)) {
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
  if (!astFactory.isMemberExpression(expression)) return null;
  const root = memberRootName(expression);
  const key = memberKey(expression);
  if (root === null) return null;
  const origin = sourceOrigin(
    ctx,
    component,
    origins,
    astFactory.identifier(root),
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

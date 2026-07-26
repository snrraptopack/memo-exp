/**
 * Collects caller-side provenance for values passed through component props.
 */
import type { Scope } from '@babel/traverse';
import * as t from '@babel/types';
import {
  canonicalStateKey,
  collectStateIds,
  memberKey,
  memberRootName,
  walkNodes,
  type Ctx,
} from '../context';
import {
  objectBindingName,
  propNameForBinding,
  type ComponentPropsPlan,
} from './props';

export type ComponentPropSourceRef =
  | { type: 'state'; key: string }
  | { type: 'prop'; name: string; path: string[] }
  | { type: 'root' }
  | { type: 'local' };

export type ComponentPropSourceRefs = Record<
  string,
  ComponentPropSourceRef[]
>;

function unwrapExpression(node: t.Expression): t.Expression {
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

function moduleStateSource(
  ctx: Ctx,
  scope: Scope,
  raw: t.Expression,
): string | null {
  const expression = unwrapExpression(raw);
  if (t.isIdentifier(expression)) {
    if (
      !ctx.state.has(expression.name) ||
      scope.getBinding(expression.name)?.scope.path.isProgram() !== true
    ) {
      return null;
    }
    return canonicalStateKey(ctx, expression.name);
  }
  if (!t.isMemberExpression(expression)) return null;
  const root = memberRootName(expression);
  if (
    root === null ||
    !ctx.state.has(root) ||
    scope.getBinding(root)?.scope.path.isProgram() !== true
  ) {
    return null;
  }
  return canonicalStateKey(ctx, memberKey(expression) ?? root);
}

function parentPropSource(
  plan: ComponentPropsPlan,
  raw: t.Expression,
): ComponentPropSourceRef | null {
  const expression = unwrapExpression(raw);
  if (t.isIdentifier(expression)) {
    const name = propNameForBinding(plan, expression.name);
    return name === null
      ? null
      : { type: 'prop', name, path: [] };
  }
  if (!t.isMemberExpression(expression)) return null;
  const root = memberRootName(expression);
  const key = memberKey(expression);
  if (root === null || key === null) return null;

  const genericProps = objectBindingName(plan);
  if (genericProps === root) {
    const [name, ...path] = key.split('.').slice(1);
    return name === undefined
      ? null
      : { type: 'prop', name, path };
  }
  const name = propNameForBinding(plan, root);
  return name === null
    ? null
    : { type: 'prop', name, path: key.split('.').slice(1) };
}

function mentionsParentProp(
  plan: ComponentPropsPlan,
  expression: t.Expression,
): boolean {
  let found = false;
  const genericProps = objectBindingName(plan);
  walkNodes(expression, (node) => {
    if (
      t.isIdentifier(node) &&
      (node.name === genericProps ||
        propNameForBinding(plan, node.name) !== null)
    ) {
      found = true;
    }
  });
  return found;
}

function isIdentityFree(expression: t.Expression): boolean {
  return (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isNullLiteral(expression) ||
    t.isBigIntLiteral(expression) ||
    t.isTemplateLiteral(expression)
  );
}

function sourceOf(
  ctx: Ctx,
  owner: string,
  scope: Scope,
  expression: t.Expression,
): ComponentPropSourceRef {
  const state = moduleStateSource(ctx, scope, expression);
  if (state !== null) return { type: 'state', key: state };

  const plan = ctx.componentProps.get(owner)!;
  const parentProp = parentPropSource(plan, expression);
  if (parentProp !== null) return parentProp;

  const root =
    t.isIdentifier(expression)
      ? expression.name
      : t.isMemberExpression(expression)
        ? memberRootName(expression)
        : null;
  if (
    (root !== null &&
      (ctx.instanceState.get(owner)?.has(root) === true ||
        ctx.instanceDerivedBindings.get(owner)?.has(root) === true)) ||
    collectStateIds(ctx, expression).size > 0 ||
    mentionsParentProp(plan, expression)
  ) {
    return { type: 'root' };
  }
  return isIdentityFree(expression)
    ? { type: 'local' }
    : { type: 'root' };
}

function addSource(
  byTag: Map<string, ComponentPropSourceRefs>,
  tag: string,
  name: string,
  source: ComponentPropSourceRef,
): void {
  const props = byTag.get(tag) ?? {};
  const sources = props[name] ?? [];
  const identity = JSON.stringify(source);
  if (!sources.some((item) => JSON.stringify(item) === identity)) {
    sources.push(source);
    sources.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  props[name] = sources;
  byTag.set(tag, props);
}

function jsxPropName(attribute: t.JSXAttribute): string | null {
  if (t.isJSXIdentifier(attribute.name)) return attribute.name.name;
  return null;
}

/** Prop-source references grouped by component tag used inside one owner. */
export function collectComponentPropSources(
  ctx: Ctx,
  owner: string,
): Map<string, ComponentPropSourceRefs> {
  const byTag = new Map<string, ComponentPropSourceRefs>();
  ctx.compPaths.get(owner)!.traverse({
    JSXOpeningElement(opening) {
      const name = opening.node.name;
      if (!t.isJSXIdentifier(name) || !/^[A-Z]/.test(name.name)) return;
      const targetPlan = ctx.componentProps.get(name.name);

      for (const attributePath of opening.get('attributes')) {
        if (attributePath.isJSXSpreadAttribute()) {
          for (const prop of targetPlan?.names ?? []) {
            addSource(byTag, name.name, prop, { type: 'root' });
          }
          continue;
        }
        if (!attributePath.isJSXAttribute()) continue;
        const prop = jsxPropName(attributePath.node);
        if (prop === null || prop === 'key') continue;
        const value = attributePath.node.value;
        if (
          !t.isJSXExpressionContainer(value) ||
          !t.isExpression(value.expression)
        ) {
          addSource(byTag, name.name, prop, { type: 'local' });
          continue;
        }
        addSource(
          byTag,
          name.name,
          prop,
          sourceOf(ctx, owner, attributePath.scope, value.expression),
        );
      }
    },
  });
  return byTag;
}

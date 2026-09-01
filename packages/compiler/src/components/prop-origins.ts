/**
 * Collects caller-side provenance for values passed through component props.
 */
import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import type { BaseNode } from '../ast';
import {
  astBindingAt,
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
  | { type: 'transparent' }
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
    astFactory.isTSAsExpression(current) ||
    astFactory.isTSTypeAssertion(current) ||
    astFactory.isTSNonNullExpression(current) ||
    astFactory.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function moduleStateSource(
  ctx: Ctx,
  raw: t.Expression,
): string | null {
  const expression = unwrapExpression(raw);
  if (astFactory.isIdentifier(expression)) {
    if (
      !ctx.state.has(expression.name) ||
      astBindingAt(ctx, expression as unknown as BaseNode, expression.name)
        ?.scope.isProgramScope !== true
    ) {
      return null;
    }
    return canonicalStateKey(ctx, expression.name);
  }
  if (!astFactory.isMemberExpression(expression)) return null;
  const root = memberRootName(expression);
  if (
    root === null ||
    !ctx.state.has(root) ||
    astBindingAt(ctx, expression as unknown as BaseNode, root)?.scope
      .isProgramScope !== true
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
  if (astFactory.isIdentifier(expression)) {
    const name = propNameForBinding(plan, expression.name);
    return name === null
      ? null
      : { type: 'prop', name, path: [] };
  }
  if (!astFactory.isMemberExpression(expression)) return null;
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
      astFactory.isIdentifier(node) &&
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
    astFactory.isStringLiteral(expression) ||
    astFactory.isNumericLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) ||
    astFactory.isNullLiteral(expression) ||
    astFactory.isBigIntLiteral(expression) ||
    astFactory.isTemplateLiteral(expression) ||
    (expression as unknown as BaseNode).type === 'Literal'
  );
}

function sourceOf(
  ctx: Ctx,
  owner: string,
  expression: t.Expression,
): ComponentPropSourceRef {
  const state = moduleStateSource(ctx, expression);
  if (state !== null) return { type: 'state', key: state };

  const plan = ctx.componentProps.get(owner)!;
  const parentProp = parentPropSource(plan, expression);
  if (parentProp !== null) return parentProp;

  if (astFactory.isIdentifier(expression)) {
    const binding = astBindingAt(
      ctx,
      expression as unknown as BaseNode,
      expression.name,
    );
    const ownerNode = ctx.compPaths.get(owner)?.node;
    const ownerBinding =
      ownerNode === undefined
        ? undefined
        : astBindingAt(
            ctx,
            ownerNode as unknown as BaseNode,
            expression.name,
          );
    if (
      binding !== undefined &&
      binding === ownerBinding &&
      ctx.transparentSources.get(owner)?.has(expression.name) === true
    ) {
      return { type: 'transparent' };
    }
  }

  const root =
    astFactory.isIdentifier(expression)
      ? expression.name
      : astFactory.isMemberExpression(expression)
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
  if (astFactory.isJSXIdentifier(attribute.name)) return attribute.name.name;
  return null;
}

/** Prop-source references grouped by component tag used inside one owner. */
export function collectComponentPropSources(
  ctx: Ctx,
  owner: string,
): Map<string, ComponentPropSourceRefs> {
  const byTag = new Map<string, ComponentPropSourceRefs>();
  const component = ctx.compPaths.get(owner)!;
  walkNodes(component.node, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const opening = node as t.JSXOpeningElement;
    const name = opening.name;
    if (!astFactory.isJSXIdentifier(name) || !/^[A-Z]/.test(name.name)) return;
    const targetPlan = ctx.componentProps.get(name.name);

    for (const attribute of opening.attributes) {
      if (astFactory.isJSXSpreadAttribute(attribute)) {
        for (const prop of targetPlan?.names ?? []) {
          if (prop === 'ref' || targetPlan?.refProps.includes(prop)) continue;
          addSource(byTag, name.name, prop, { type: 'root' });
        }
        continue;
      }
      if (!astFactory.isJSXAttribute(attribute)) continue;
      const prop = jsxPropName(attribute);
      if (
        prop === null ||
        prop === 'key' ||
        prop === 'ref' ||
        targetPlan?.refProps.includes(prop) === true
      ) {
        continue;
      }
      const value = attribute.value;
      if (
        !astFactory.isJSXExpressionContainer(value) ||
        value.expression.type === 'JSXEmptyExpression'
      ) {
        addSource(byTag, name.name, prop, { type: 'local' });
        continue;
      }
      addSource(
        byTag,
        name.name,
        prop,
        sourceOf(ctx, owner, value.expression as t.Expression),
      );
    }
  });
  return byTag;
}

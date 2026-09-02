/**
 * Collects caller-side provenance for values passed through component props.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { extractPatternIdentifiers, type BaseNode } from '../ast';
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

function sourceRefForBinding(
  ctx: Ctx,
  owner: string,
  name: string,
): ComponentPropSourceRef {
  const plan = ctx.componentProps.get(owner)!;
  const expression = astFactory.identifier(name);
  const parentProp = parentPropSource(plan, expression);
  if (parentProp !== null) return parentProp;

  const ownerNode = ctx.compPaths.get(owner)?.node;
  const binding =
    ownerNode === undefined
      ? undefined
      : astBindingAt(ctx, ownerNode as unknown as BaseNode, name);
  if (ctx.state.has(name) && binding?.scope.isProgramScope === true) {
    return { type: 'state', key: canonicalStateKey(ctx, name) };
  }
  return { type: 'root' };
}

function listCallbackSource(
  ctx: Ctx,
  expression: t.Expression,
): t.Expression | null {
  if (!astFactory.isIdentifier(expression)) return null;
  const parents = ctx.astAnalysis?.parentByNode;
  if (parents === undefined) return null;
  let current = expression as unknown as BaseNode;
  for (;;) {
    const parent = parents.get(current);
    if (parent === undefined || parent === null) return null;
    if (
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'FunctionDeclaration'
    ) {
      const parameters = (parent as unknown as t.Function).params;
      const ownsBinding = parameters.some((parameter) =>
        extractPatternIdentifiers(parameter as unknown as BaseNode)
          .some(({ name }) => name === expression.name),
      );
      if (!ownsBinding) {
        current = parent;
        continue;
      }
      const call = parents.get(parent);
      if (
        call === null ||
        call?.type !== 'CallExpression' &&
        call?.type !== 'OptionalCallExpression'
      ) {
        return null;
      }
      const typedCall = call as unknown as
        | t.CallExpression
        | t.OptionalCallExpression;
      const callee = typedCall.callee;
      if (
        (!astFactory.isMemberExpression(callee) &&
          !astFactory.isOptionalMemberExpression(callee)) ||
        callee.computed ||
        !astFactory.isIdentifier(callee.property, { name: 'map' }) ||
        !astFactory.isExpression(callee.object)
      ) {
        return null;
      }
      return callee.object;
    }
    current = parent;
  }
}

function collectionSources(
  ctx: Ctx,
  owner: string,
  expression: t.Expression,
): ComponentPropSourceRef[] {
  const state = moduleStateSource(ctx, expression);
  if (state !== null) return [{ type: 'state', key: state }];

  const plan = ctx.componentProps.get(owner)!;
  const parentProp = parentPropSource(plan, expression);
  if (parentProp !== null) return [parentProp];
  if (!astFactory.isIdentifier(expression)) return [{ type: 'root' }];

  const derivation = (ctx.instanceDerivations.get(owner) ?? []).find(
    (candidate) => candidate.bindings.includes(expression.name),
  );
  if (derivation === undefined) {
    return [sourceRefForBinding(ctx, owner, expression.name)];
  }
  const sources = derivation.sources.map((dependency) =>
    sourceRefForBinding(ctx, owner, dependency),
  );
  return sources.length > 0 ? sources : [{ type: 'root' }];
}

/**
 * Recover the origin of a component prop passed from a keyed-list callback.
 * The callback item itself is not a lexical state binding, but the analyzed
 * list site still records the collection boundary that supplied it.
 */
function listItemSources(
  ctx: Ctx,
  owner: string,
  tag: string,
  expression: t.Expression,
): ComponentPropSourceRef[] | null {
  if (!astFactory.isIdentifier(expression)) return null;
  const lexicalSource = listCallbackSource(ctx, expression);
  if (lexicalSource !== null) {
    return collectionSources(ctx, owner, lexicalSource);
  }
  const sites = [
    ...(ctx.listedSites?.get(tag) ?? []),
    ...(ctx.rowComponentSites?.get(tag) ?? []),
  ].filter(
    (site) =>
      site.owner === owner &&
      site.itemParam === expression.name,
  );
  if (sites.length === 0) return null;

  const refs: ComponentPropSourceRef[] = [];
  const add = (ref: ComponentPropSourceRef): void => {
    const identity = JSON.stringify(ref);
    if (!refs.some((candidate) => JSON.stringify(candidate) === identity)) {
      refs.push(ref);
    }
  };
  for (const site of sites) {
    const source = site.sourceKey;
    if (source === undefined || source === '') {
      add({ type: 'root' });
      continue;
    }
    if (site.sourceLocal !== true) {
      add({ type: 'state', key: canonicalStateKey(ctx, source) });
      continue;
    }

    const derivation = (ctx.instanceDerivations.get(owner) ?? []).find(
      (candidate) => candidate.bindings.includes(source),
    );
    if (derivation === undefined) {
      add(sourceRefForBinding(ctx, owner, source.split('.')[0]!));
      continue;
    }
    for (const dependency of derivation.sources) {
      add(sourceRefForBinding(ctx, owner, dependency));
    }
  }
  return refs;
}

function sourcesOf(
  ctx: Ctx,
  owner: string,
  tag: string,
  expression: t.Expression,
): ComponentPropSourceRef[] {
  const unwrapped = unwrapExpression(expression);
  const listSources = listItemSources(ctx, owner, tag, unwrapped);
  if (listSources !== null) return listSources;

  const state = moduleStateSource(ctx, unwrapped);
  if (state !== null) return [{ type: 'state', key: state }];

  const plan = ctx.componentProps.get(owner)!;
  const parentProp = parentPropSource(plan, unwrapped);
  if (parentProp !== null) return [parentProp];

  if (astFactory.isIdentifier(unwrapped)) {
    const binding = astBindingAt(
      ctx,
      unwrapped as unknown as BaseNode,
      unwrapped.name,
    );
    const ownerNode = ctx.compPaths.get(owner)?.node;
    const ownerBinding =
      ownerNode === undefined
        ? undefined
        : astBindingAt(
            ctx,
            ownerNode as unknown as BaseNode,
            unwrapped.name,
          );
    if (
      binding !== undefined &&
      binding === ownerBinding &&
      ctx.transparentSources.get(owner)?.has(unwrapped.name) === true
    ) {
      return [{ type: 'transparent' }];
    }
  }

  const root =
    astFactory.isIdentifier(unwrapped)
      ? unwrapped.name
      : astFactory.isMemberExpression(unwrapped)
        ? memberRootName(unwrapped)
        : null;
  if (
    (root !== null &&
      (ctx.instanceState.get(owner)?.has(root) === true ||
        ctx.instanceDerivedBindings.get(owner)?.has(root) === true)) ||
    collectStateIds(ctx, unwrapped).size > 0 ||
    mentionsParentProp(plan, unwrapped)
  ) {
    return [{ type: 'root' }];
  }
  return [
    isIdentityFree(unwrapped)
      ? { type: 'local' }
      : { type: 'root' },
  ];
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
      for (const source of sourcesOf(
        ctx,
        owner,
        name.name,
        value.expression as t.Expression,
      )) {
        addSource(byTag, name.name, prop, source);
      }
    }
  });
  return byTag;
}

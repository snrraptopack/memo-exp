/** Conservative selectors for statically understood imported `route` reads. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { astBindingAt, type Ctx } from '../context';

export type RouteReadSelector =
  | { readonly kind: 'member'; readonly path: readonly string[] }
  | {
      readonly kind: 'query';
      readonly method: 'get' | 'has' | 'toString';
      readonly args: readonly string[];
    };

const SCALAR_FIELDS = new Set([
  'href',
  'pathname',
  'search',
  'hash',
  'navigationType',
]);

function memberKey(node: BaseNode | undefined): string | null {
  if (node?.type !== 'MemberExpression') return null;
  const member = node as t.MemberExpression;
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }
  return null;
}

function literalString(node: t.Expression | t.SpreadElement): string | null {
  return node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

function selectorFor(
  root: BaseNode,
  parents: ReadonlyMap<BaseNode, BaseNode>,
): RouteReadSelector | null {
  const first = parents.get(root);
  if (first?.type !== 'MemberExpression' || (first as t.MemberExpression).object !== root) {
    return null;
  }
  const field = memberKey(first);
  if (field !== null && SCALAR_FIELDS.has(field)) {
    return { kind: 'member', path: [field] };
  }
  const second = parents.get(first);
  if (
    second?.type !== 'MemberExpression' ||
    (second as t.MemberExpression).object !== first
  ) {
    return null;
  }
  const key = memberKey(second);
  if (key === null) return null;
  if (field === 'params') {
    return { kind: 'member', path: ['params', key] };
  }
  if (field !== 'query') return null;
  if (key === 'size') return { kind: 'member', path: ['query', 'size'] };
  if (key !== 'get' && key !== 'has' && key !== 'toString') return null;

  const call = parents.get(second);
  if (call?.type !== 'CallExpression' || (call as t.CallExpression).callee !== second) {
    return null;
  }
  const arguments_ = (call as t.CallExpression).arguments;
  if (key === 'toString') {
    return arguments_.length === 0
      ? { kind: 'query', method: key, args: [] }
      : null;
  }
  if (arguments_.length < 1 || arguments_.length > (key === 'has' ? 2 : 1)) {
    return null;
  }
  const args = arguments_.map(literalString);
  return args.every((arg): arg is string => arg !== null)
    ? { kind: 'query', method: key, args }
    : null;
}

/** Null means an indirect/dynamic read requires the existing whole-route path. */
export function componentRouteSelectors(
  ctx: Ctx,
  component: t.FunctionDeclaration,
  bindingName: string,
): RouteReadSelector[] | null {
  const parents = new Map<BaseNode, BaseNode>();
  const roots: BaseNode[] = [];
  let unknownBinding = false;
  walkAst<BaseNode>(component as BaseNode, {
    enter(node, parent) {
      if (parent !== null) parents.set(node, parent);
      if (node.type !== 'Identifier' || (node as t.Identifier).name !== bindingName) {
        return;
      }
      const binding = astBindingAt(ctx, node, bindingName);
      if (binding === undefined) {
        unknownBinding = true;
      } else if (
        binding.kind === 'import' &&
        binding.references.includes(node as t.Identifier)
      ) {
        roots.push(node);
      }
    },
  });
  if (unknownBinding || roots.length === 0) return null;
  const selectors = new Map<string, RouteReadSelector>();
  for (const root of roots) {
    const selector = selectorFor(root, parents);
    if (selector === null) return null;
    selectors.set(JSON.stringify(selector), selector);
  }
  return [...selectors.values()];
}

export function routeSelectorExpression(
  selector: RouteReadSelector,
  route: t.Identifier,
): t.Expression {
  if (selector.kind === 'member') {
    return selector.path.reduce<t.Expression>(
      (object, key) => astFactory.memberExpression(
        object,
        astFactory.stringLiteral(key),
        true,
      ),
      route,
    );
  }
  return astFactory.callExpression(
    astFactory.memberExpression(
      astFactory.memberExpression(route, astFactory.identifier('query')),
      astFactory.identifier(selector.method),
    ),
    selector.args.map(astFactory.stringLiteral),
  );
}

/** Build deferred scene factories from the shared composition and callback plans. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { extractPatternIdentifiers, type BaseNode } from '../ast';
import type { RenderCallbackPlan } from '../components/render-callbacks';
import type { ParentRow } from '../lists/map-site';
import { planDirectChildren } from '../jsx/children';

interface ContentOptions {
  content: t.Identifier;
  renderCallback: t.Identifier;
  setup: t.Statement[];
  captures?: readonly t.Identifier[];
  row?: ParentRow;
  fresh(name: string): t.Identifier;
  inline(
    root: t.Node,
    captures?: readonly t.Identifier[],
    row?: ParentRow,
  ): {
    component: t.Identifier;
    props: t.Expression;
  };
  renderPlan(value: t.Expression): RenderCallbackPlan;
  isContent(value: t.Expression): boolean;
  fail(message: string, at: t.Node): never;
}

export function desktopContent(value: t.Expression, options: ContentOptions): t.Expression {
  if (
    b.isNullLiteral(value) ||
    b.isBooleanLiteral(value) ||
    b.isIdentifier(value, { name: 'undefined' })
  ) {
    return value;
  }
  const root =
    b.isJSXElement(value) || b.isJSXFragment(value)
      ? value
      : b.jsxFragment(b.jsxOpeningFragment(), b.jsxClosingFragment(), [
          b.jsxExpressionContainer(value),
        ]);
  if (b.isJSXFragment(root)) {
    const children = planDirectChildren(root.children, {
      preserveTextBoundaries: true,
      cloneExpressions: false,
      isForwarded: options.isContent,
      fail: (message) => options.fail(message, value),
    });
    if (!children.length) return b.nullLiteral();
    if (children.length === 1 && children[0]!.type === 'slot') return children[0]!.expression;
  }
  const fragment = options.inline(root, options.captures, options.row);
  const expression = b.callExpression(options.content, [
    fragment.component,
    b.arrowFunctionExpression([], fragment.props),
  ]);
  // A named row's props are read in the collection callback. Capture its
  // bindings there; the retained factory itself is defined in the caller.
  if (options.captures?.length) return expression;
  const content = options.fresh('__desktopContent');
  options.setup.push(b.variableDeclaration('const', [b.variableDeclarator(content, expression)]));
  return content;
}

export function desktopRenderCallback(value: t.Expression, options: ContentOptions): t.Expression {
  const plan = options.renderPlan(value);
  if (!plan.keyExpression)
    options.fail('desktop render callbacks require an explicit key={...}', value);
  const index = plan.indexParam
    ? b.identifier(plan.indexParam)
    : options.fresh('__desktopRenderIndex');
  const captures = [
    ...extractPatternIdentifiers(plan.itemPattern as unknown as BaseNode).map((binding) =>
      b.identifier(binding.name),
    ),
    index,
  ];
  const bound = new Set(captures.map((capture) => capture.name));
  captures.push(...(options.captures ?? []).filter((capture) => !bound.has(capture.name)));
  const fragment = options.inline(plan.jsx, captures, {
    itemParam: plan.itemParam,
    sourceKey: '$desktopRenderRow',
    sourceLocal: true,
  });
  const callback = options.fresh('__desktopRenderCallback');
  // Destructure each item once, then derive both its key and capture envelope.
  const descriptor = b.objectExpression([
    b.objectProperty(b.identifier('key'), plan.keyExpression),
    b.objectProperty(b.identifier('props'), fragment.props),
  ]);
  const expression = b.callExpression(options.renderCallback, [
    fragment.component,
    b.arrowFunctionExpression([plan.itemPattern, index], descriptor),
  ]);
  if (options.captures?.length) return expression;
  options.setup.push(b.variableDeclaration('const', [b.variableDeclarator(callback, expression)]));
  return callback;
}

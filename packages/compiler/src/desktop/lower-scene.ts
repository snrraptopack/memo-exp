/** Encode authored structure; Rust owns tag translation and content semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentCallbacks } from '../planning/component-callbacks';
import type { ComponentExpressionSources } from '../analysis/expression-sources';

type SceneNode =
  | { kind: 'element'; tag: string; parent: number | null; text: '' }
  | { kind: 'text'; parent: number | null; text: string };
interface TextSlot { node: number; type: 'text' }

export function lowerDesktopScene(root: t.Node, options: {
  callbacks: ComponentCallbacks;
  sources: ComponentExpressionSources;
  instrument: t.Identifier;
  fail: (message: string, at: t.Node) => never;
}) {
  const { callbacks, sources, instrument } = options;
  const fail: (message: string, at: t.Node) => never = options.fail;
  const nodes: SceneNode[] = [];
  const slots: TextSlot[] = [];
  const bindings: t.Expression[] = [];
  const events: { node: number; type: 'click' }[] = [];
  const handlers: t.Expression[] = [];

  const addText = (text: string, parent: number | null): number => {
    const node = nodes.length;
    nodes.push({ kind: 'text', parent, text });
    return node;
  };
  const emit = (element: t.Node, parent: number | null): void => {
    if (b.isJSXFragment(element)) {
      for (const child of element.children) emit(child, parent);
      return;
    }
    if (b.isJSXText(element)) {
      if (element.value !== '') addText(element.value, parent);
      return;
    }
    if (b.isJSXExpressionContainer(element)) {
      const expression = unwrapTypeExpression(element.expression);
      if (b.isJSXEmptyExpression(expression)) return;
      walkAst<t.Node>(expression, { enter(node) {
        if (b.isJSXElement(node) || b.isJSXFragment(node) || node.type === 'ConditionalExpression' ||
            node.type === 'LogicalExpression' || node.type === 'ArrayExpression' || node.type === 'ArrowFunctionExpression' ||
            node.type === 'FunctionExpression') fail('structural expressions are not implemented yet', node);
      } });
      const slot = slots.length;
      slots.push({ node: addText('', parent), type: 'text' });
      let dependencies = sources.sourcesFor(expression as t.Expression);
      walkAst<t.Node>(expression, { enter(node) {
        // Desktop's first slice has no getter/property provenance analysis.
        // Hidden reads must refresh even when the receiver's binding is stable.
        if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') dependencies = null;
      } });
      bindings.push(b.objectExpression([
        b.objectProperty(b.identifier('slot'), b.numericLiteral(slot)),
        b.objectProperty(b.identifier('sources'), valueExpression(dependencies)),
        b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], expression as t.Expression)),
      ]));
      return;
    }
    if (!b.isJSXElement(element)) fail('unsupported JSX child', element);
    const opening = element.openingElement;
    if (!b.isJSXIdentifier(opening.name)) fail('dynamic tags are not implemented yet', opening);
    const tag = opening.name.name;
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) fail('component tags require desktop component linking, which is not implemented yet', opening);
    const node = nodes.length;
    nodes.push({ kind: 'element', tag, parent, text: '' });
    let hasClick = false;
    for (const attribute of opening.attributes) {
      if (!b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name) || attribute.name.name !== 'onClick') {
        fail('only onClick is supported in this first desktop slice', attribute);
      }
      if (hasClick) fail('duplicate onClick attribute', attribute);
      hasClick = true;
      const value = attribute.value;
      if (!value || !b.isJSXExpressionContainer(value)) fail('onClick requires a callback expression', attribute);
      const expression = unwrapTypeExpression(value.expression) as t.Expression;
      const callback = callbacks.forEvent(expression);
      if (!callback) fail('onClick requires an inline callback or component-local helper', attribute);
      assertSynchronousCallback(callback.target, fail);
      for (const helper of callback.helpers) assertSynchronousCallback(helper.target, fail);
      const plan = callback.writesFor(undefined, true);
      const changed = new Set<string>();
      let conservative = plan.executionAwareRoot;
      for (const writes of plan.scopes.values()) {
        for (const key of writes.instanceWrites) changed.add(key.split('.')[0]!);
        conservative ||= writes.rootFallback || writes.eventFallback || writes.writes.size > 0;
      }
      // Helpers are kept intact. Their effects are conservatively replayed until
      // desktop lowering instruments their individual mutation sites.
      conservative ||= callback.helpers.length > 0;
      events.push({ node, type: 'click' });
      handlers.push(b.callExpression(instrument, [expression,
        valueExpression(conservative ? null : [...changed].sort())]));
    }
    for (const child of element.children) emit(child, node);
  };
  emit(root, null);
  // One template root makes mount/disposal identity unambiguous.
  if (nodes.filter(node => node.parent === null).length !== 1) fail('a scene must have one root primitive', root);
  return { nodes, slots, events, bindings, handlers };
}

export function valueExpression(value: unknown): t.Expression {
  if (Array.isArray(value)) return b.arrayExpression(value.map(valueExpression));
  if (value !== null && typeof value === 'object') return b.objectExpression(Object.entries(value).map(([key, item]) =>
    b.objectProperty(b.identifier(key), valueExpression(item))));
  if (value === null) return b.nullLiteral();
  if (typeof value === 'string') return b.stringLiteral(value);
  if (typeof value === 'number') return b.numericLiteral(value);
  if (typeof value === 'boolean') return b.booleanLiteral(value);
  throw new TypeError('Invalid desktop template value');
}

function assertSynchronousCallback(node: t.Node, fail: (message: string, at: t.Node) => never): void {
  walkAst(node, { enter(current) {
    if (current.type === 'AwaitExpression' || current.type === 'YieldExpression' ||
        ('async' in current && current.async === true)) fail('asynchronous callbacks are not implemented yet', current);
  } });
}


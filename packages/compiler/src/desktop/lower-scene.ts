/** Encode authored structure; Rust owns tag translation and content semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentCallbacks } from '../planning/component-callbacks';
import type { ComponentExpressionSources } from '../analysis/expression-sources';
import { desktopInlineDeclarations, type DesktopDeclaration } from './css';
import { normalizeCssPropertyName } from '@tsrx/core';
import type { ComponentPropsPlan } from '../components/props';
import type { LinkedComponentImport } from '../context/model';
import { desktopComponentCall } from './component-call';
import { desktopRegionPlan } from './regions';
import { nodeHasJsx } from '../context/ast';
import { matchMapCall, type MapSite } from '../lists';
import type { MapCallExpression } from '../context';
import { desktopListPlan } from './lists';

type SceneNode =
  | { kind: 'element'; tag: string; parent: number | null; text: ''; attributes: Record<string, string>; style: DesktopDeclaration[] }
  | { kind: 'text'; parent: number | null; text: string }
  | { kind: 'region'; parent: number | null; multiple?: boolean };
interface TextSlot { node: number; type: 'text' | 'value' }

export function lowerDesktopScene(root: t.Node, options: {
  callbacks: ComponentCallbacks;
  sources: ComponentExpressionSources;
  instrument: t.Identifier;
  components: ReadonlyMap<string, ComponentPropsPlan>;
  imports: ReadonlyMap<string, LinkedComponentImport>;
  fresh: (name: string) => t.Identifier;
  listSite: (call: MapCallExpression) => MapSite;
  fail: (message: string, at: t.Node) => never;
}) {
  const { callbacks, sources, instrument } = options;
  const fail: (message: string, at: t.Node) => never = options.fail;
  const nodes: SceneNode[] = [];
  const slots: TextSlot[] = [];
  const bindings: t.Expression[] = [];
  const events: { node: number; type: 'click' | 'change' }[] = [];
  const handlers: t.Expression[] = [];
  const children: t.Expression[] = [];
  const regions: t.Expression[] = [];
  const lists: t.Expression[] = [];
  const componentNames = new Set<string>();
  const dependenciesFor = (expression: t.Expression): readonly string[] | null => {
    let dependencies = sources.sourcesFor(expression);
    walkAst<t.Node>(expression, { enter(node) { if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') dependencies = null; } });
    return dependencies;
  };
  const componentCall = (element: t.JSXElement) => desktopComponentCall(element, { ...options, sourcesFor: dependenciesFor });
  const addList = (call: MapCallExpression, parent: number | null): void => {
    assertSynchronousCallback(call, fail);
    const plan = desktopListPlan(options.listSite(call), { call: componentCall, fresh: options.fresh, fail, sourcesFor: dependenciesFor });
    const node = nodes.length; nodes.push({ kind: 'region', parent, multiple: true });
    componentNames.add(plan.component.name);
    lists.push(b.objectExpression([
      b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
      b.objectProperty(b.identifier('sources'), valueExpression(plan.sources)),
      b.objectProperty(b.identifier('component'), plan.component),
      b.objectProperty(b.identifier('read'), plan.read),
    ]));
  };
  const addRegion = (expression: t.ConditionalExpression | t.LogicalExpression, parent: number | null): void => {
    const plan = desktopRegionPlan(expression, { call: componentCall, sourcesFor: dependenciesFor, fresh: options.fresh, fail });
    const node = nodes.length; nodes.push({ kind: 'region', parent });
    for (const choice of plan.choices) if (b.isIdentifier(choice)) componentNames.add(choice.name);
    regions.push(b.objectExpression([
      b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
      b.objectProperty(b.identifier('sources'), valueExpression(plan.sources)),
      b.objectProperty(b.identifier('branches'), b.arrayExpression(plan.choices)),
      b.objectProperty(b.identifier('read'), plan.read),
    ]));
  };

  const addText = (text: string, parent: number | null): number => {
    const node = nodes.length;
    nodes.push({ kind: 'text', parent, text });
    return node;
  };
  const addBinding = (expression: t.Expression, node: number, type: TextSlot['type']): void => {
    if (nodeHasJsx(expression)) fail('structural expressions are not implemented yet', expression);
    if (['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression'].includes(expression.type)) fail('text/value expressions require primitive results', expression);
    // Call arguments may contain predicates and conditional scalar expressions.
    // The resulting value is still checked by the runtime's primitive slot contract.
    assertSynchronousCallback(expression, fail);
    const slot = slots.length;
    slots.push({ node, type });
    const dependencies = dependenciesFor(expression);
    bindings.push(b.objectExpression([
      b.objectProperty(b.identifier('slot'), b.numericLiteral(slot)),
      b.objectProperty(b.identifier('sources'), valueExpression(dependencies)),
      b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], expression)),
    ]));
  };
  const emit = (element: t.Node, parent: number | null): void => {
    const map = matchMapCall(element);
    if (map && nodeHasJsx(element)) { addList(map, parent); return; }
    if (b.isConditionalExpression(element) || b.isLogicalExpression(element)) { addRegion(element, parent); return; }
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
      const map = matchMapCall(expression);
      if (map && nodeHasJsx(expression)) { addList(map, parent); return; }
      if ((b.isConditionalExpression(expression) || b.isLogicalExpression(expression)) && nodeHasJsx(expression)) { addRegion(expression, parent); return; }
      addBinding(expression as t.Expression, addText('', parent), 'text');
      return;
    }
    if (!b.isJSXElement(element)) fail('unsupported JSX child', element);
    const opening = element.openingElement;
    if (!b.isJSXIdentifier(opening.name)) fail('dynamic tags are not implemented yet', opening);
    const tag = opening.name.name;
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      const call = componentCall(element);
      componentNames.add(call.component.name);
      const node = nodes.length; nodes.push({ kind: 'region', parent });
      children.push(b.objectExpression([
        b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
        b.objectProperty(b.identifier('sources'), valueExpression(call.sources)),
        b.objectProperty(b.identifier('component'), call.component),
        b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], call.props)),
      ]));
      return;
    }
    const node = nodes.length;
    const attributes: Record<string, string> = {};
    const style: DesktopDeclaration[] = [];
    nodes.push({ kind: 'element', tag, parent, text: '', attributes, style });
    let hasClick = false;
    let hasChange = false;
    const seen = new Set<string>();
    for (const attribute of opening.attributes) {
      if (!b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name)) fail('spread and namespaced attributes are not implemented', attribute);
      const name = attribute.name.name === 'className' ? 'class' : attribute.name.name;
      if (seen.has(name)) fail(`duplicate ${name} attribute`, attribute);
      seen.add(name);
      if (!['onClick', 'onChange', 'onInput'].includes(name)) {
        if (!['class', 'id', 'style', 'title', 'aria-label'].includes(name) && !(tag === 'input' && ['type', 'value', 'placeholder'].includes(name))) fail(`desktop attribute ${name} is not implemented`, attribute);
        let literal: t.Node | null | undefined = attribute.value;
        if (literal && b.isJSXExpressionContainer(literal)) literal = unwrapTypeExpression(literal.expression);
        if (tag === 'input' && name === 'value' && literal && attribute.value && b.isJSXExpressionContainer(attribute.value)) {
          addBinding(literal as t.Expression, node, 'value');
          continue;
        }
        if (name === 'style' && literal && b.isObjectExpression(literal)) {
          for (const property of literal.properties) {
            if (!b.isObjectProperty(property) || property.computed || (!b.isIdentifier(property.key) && !b.isStringLiteral(property.key))) fail('style objects require static named properties', property);
            const key = normalizeCssPropertyName(b.isIdentifier(property.key) ? property.key.name : property.key.value);
            const value = unwrapTypeExpression(property.value);
            if (!b.isStringLiteral(value) && !b.isNumericLiteral(value)) fail('style objects currently require static values', property);
            const unitless = ['opacity', 'line-height', 'font-weight', 'flex-grow', 'flex-shrink'].includes(key);
            style.push({ property: key, value: b.isNumericLiteral(value) && !unitless && value.value !== 0 ? `${value.value}px` : String(value.value) });
          }
          continue;
        }
        if (!literal || !b.isStringLiteral(literal)) fail(`${name} currently requires a static string`, attribute);
        if (name === 'style') style.push(...desktopInlineDeclarations(literal.value));
        else attributes[name] = literal.value;
        continue;
      }
      const change = name !== 'onClick';
      if (change && tag !== 'input') fail(`${name} requires an input control`, attribute);
      if (change ? hasChange : hasClick) fail(`duplicate ${change ? 'input change' : 'onClick'} handler`, attribute);
      if (change) hasChange = true; else hasClick = true;
      const value = attribute.value;
      if (!value || !b.isJSXExpressionContainer(value)) fail(`${name} requires a callback expression`, attribute);
      const expression = unwrapTypeExpression(value.expression) as t.Expression;
      const callback = callbacks.forEvent(expression);
      if (!callback) fail(`${name} requires an inline callback or component-local helper`, attribute);
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
      events.push({ node, type: change ? 'change' : 'click' });
      handlers.push(b.callExpression(instrument, [expression,
        valueExpression(conservative ? null : [...changed].sort())]));
    }
    for (const child of element.children) emit(child, node);
  };
  emit(root, null);
  // A component handle owns all fragment roots; regions flatten them at placement.
  if (!nodes.length) fail('empty desktop fragments are not implemented yet', root);
  return { nodes, slots, events, bindings, handlers, children, regions, lists, componentNames: [...componentNames] };
}

export function valueExpression(value: unknown): t.Expression {
  if (Array.isArray(value)) return b.arrayExpression(value.map(valueExpression));
  if (value !== null && typeof value === 'object') return b.objectExpression(Object.entries(value).map(([key, item]) =>
    b.objectProperty(/^[A-Za-z_$][\w$]*$/.test(key) ? b.identifier(key) : b.stringLiteral(key), valueExpression(item))));
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

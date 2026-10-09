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

type SceneNode =
  | { kind: 'element'; tag: string; parent: number | null; text: ''; attributes: Record<string, string>; style: DesktopDeclaration[] }
  | { kind: 'text'; parent: number | null; text: string }
  | { kind: 'region'; parent: number | null };
interface TextSlot { node: number; type: 'text' | 'value' }

export function lowerDesktopScene(root: t.Node, options: {
  callbacks: ComponentCallbacks;
  sources: ComponentExpressionSources;
  instrument: t.Identifier;
  components: ReadonlyMap<string, ComponentPropsPlan>;
  imports: ReadonlyMap<string, LinkedComponentImport>;
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
  const dependenciesFor = (expression: t.Expression): readonly string[] | null => {
    let dependencies = sources.sourcesFor(expression);
    walkAst<t.Node>(expression, { enter(node) { if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') dependencies = null; } });
    return dependencies;
  };

  const addText = (text: string, parent: number | null): number => {
    const node = nodes.length;
    nodes.push({ kind: 'text', parent, text });
    return node;
  };
  const addBinding = (expression: t.Expression, node: number, type: TextSlot['type']): void => {
    walkAst<t.Node>(expression, { enter(current) {
      if (b.isJSXElement(current) || b.isJSXFragment(current) || ['ConditionalExpression', 'LogicalExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression'].includes(current.type)) fail('structural expressions are not implemented yet', current);
    } });
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
      addBinding(expression as t.Expression, addText('', parent), 'text');
      return;
    }
    if (!b.isJSXElement(element)) fail('unsupported JSX child', element);
    const opening = element.openingElement;
    if (!b.isJSXIdentifier(opening.name)) fail('dynamic tags are not implemented yet', opening);
    const tag = opening.name.name;
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      const plan = options.components.get(tag);
      const imported = options.imports.get(tag);
      if (!/^[A-Z]/.test(tag) || (!plan && !options.imports.has(tag))) fail(`unresolved desktop component <${tag}>`, opening);
      if (element.children.some(child => !(b.isJSXText(child) && !child.value.trim()) && !(b.isJSXExpressionContainer(child) && b.isJSXEmptyExpression(child.expression)))) fail('component children require render-prop regions, which are not implemented yet', element);
      const node = nodes.length; nodes.push({ kind: 'region', parent });
      const props: t.ObjectProperty[] = [];
      const seen = new Set<string>();
      let dependencies: Set<string> | null = new Set();
      for (const attribute of opening.attributes) {
        if (!b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name)) fail('component props require named attributes', attribute);
        const name = attribute.name.name;
        if (seen.has(name)) fail(`duplicate ${name} prop`, attribute);
        seen.add(name);
        const names = plan?.names ?? imported?.props;
        const acceptsUnknown = plan?.acceptsUnknown ?? imported?.acceptsUnknownProps;
        if (names && !acceptsUnknown && !names.includes(name)) fail(`component <${tag}> does not declare prop ${name}`, attribute);
        let value: t.Expression = b.booleanLiteral(true);
        if (attribute.value) {
          value = (b.isJSXExpressionContainer(attribute.value) ? unwrapTypeExpression(attribute.value.expression) : attribute.value) as t.Expression;
          walkAst<t.Node>(value, { enter(current) {
            if (b.isJSXElement(current) || b.isJSXFragment(current) || b.isJSXEmptyExpression(current) || ['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression'].includes(current.type)) fail('desktop child props currently require primitive expressions', current);
          } });
        }
        const reads = dependenciesFor(value);
        if (reads === null) dependencies = null;
        else if (dependencies) for (const source of reads) dependencies.add(source);
        props.push(b.objectProperty(b.stringLiteral(name), value, true));
      }
      children.push(b.objectExpression([
        b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
        b.objectProperty(b.identifier('sources'), valueExpression(dependencies === null ? null : [...dependencies].sort())),
        b.objectProperty(b.identifier('component'), b.identifier(tag)),
        b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], b.objectExpression(props))),
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
  return { nodes, slots, events, bindings, handlers, children };
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

/** Authored props shared by fixed and conditional desktop component sites. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentPropsPlan } from '../components/props';
import type { LinkedComponentImport } from '../context/model';
import { planOrderedAttributes } from '../jsx/attributes';
import { emitOrderedAttributes } from '../emission/ordered-attributes';
import { nodeHasJsx } from '../context/ast';

export function desktopComponentCall(
  element: t.JSXElement,
  options: {
    components: ReadonlyMap<string, ComponentPropsPlan>;
    imports: ReadonlyMap<string, LinkedComponentImport>;
    sourcesFor: (expression: t.Expression) => readonly string[] | null;
    fail: (message: string, at: t.Node) => never;
    isContent(expression: t.Expression): boolean;
    isRenderCallback(expression: t.Expression): boolean;
    content(expression: t.Expression): t.Expression;
    renderCallback(expression: t.Expression): t.Expression;
  },
) {
  const fail: (message: string, at: t.Node) => never = options.fail;
  const opening = element.openingElement;
  if (!b.isJSXIdentifier(opening.name))
    fail('expected a normalized finite JSX tag selection', opening);
  const tag = opening.name.name;
  const plan = options.components.get(tag);
  const imported = options.imports.get(tag);
  if (!/^[A-Z]/.test(tag) || (!plan && !imported))
    fail(`unresolved desktop component <${tag}>`, opening);
  const hasChildren = element.children.some(
    (child) =>
      !(b.isJSXText(child) && !child.value.trim()) &&
      !(b.isJSXExpressionContainer(child) && b.isJSXEmptyExpression(child.expression)),
  );
  const attributes = planOrderedAttributes(opening.attributes, {
    cloneExpressions: false,
    fail: (message) => fail(message, opening),
  });
  const hasSpread = attributes.entries.some((entry) => entry.type === 'spread');
  if (
    hasChildren &&
    attributes.entries.some((entry) => entry.type === 'attribute' && entry.name === 'children')
  ) {
    fail(`<${tag}> cannot use both a children prop and nested JSX children`, element);
  }
  const renderProps = plan?.renderProps ?? imported?.renderProps ?? [];
  const renderCallbacks = plan?.renderCallbacks ?? imported?.renderCallbacks ?? [];
  const lowerValue = (name: string, value: t.Expression): t.Expression => {
    if (renderCallbacks.includes(name)) {
      return options.isRenderCallback(value) ? value : options.renderCallback(value);
    }
    if (renderProps.includes(name))
      return options.isContent(value) ? value : options.content(value);
    return value;
  };
  const seen = new Set<string>();
  let dependencies: Set<string> | null = new Set();
  for (const entry of attributes.entries) {
    if (entry.type === 'spread') {
      const reads = options.sourcesFor(entry.value);
      if (reads === null) dependencies = null;
      else if (dependencies) for (const source of reads) dependencies.add(source);
      if (b.isObjectExpression(entry.value)) {
        for (const property of entry.value.properties) {
          if (!b.isObjectProperty(property) || property.computed || !b.isExpression(property.value))
            continue;
          const name = b.isIdentifier(property.key)
            ? property.key.name
            : b.isStringLiteral(property.key)
              ? property.key.value
              : null;
          if (name) property.value = lowerValue(name, property.value);
        }
      }
      continue;
    }
    const name = entry.name;
    const attribute = opening;
    if (seen.has(name) && !hasSpread) fail(`duplicate ${name} prop`, attribute);
    seen.add(name);
    const names = plan?.names ?? imported?.props;
    const acceptsUnknown = plan?.acceptsUnknown ?? imported?.acceptsUnknownProps;
    if (names && !acceptsUnknown && !names.includes(name))
      fail(`component <${tag}> does not declare prop ${name}`, attribute);
    const value = unwrapTypeExpression(entry.value) as t.Expression;
    const reads = options.sourcesFor(value);
    if (reads === null) dependencies = null;
    else if (dependencies) for (const source of reads) dependencies.add(source);
    const lowered = lowerValue(name, value);
    if (lowered !== value || options.isContent(value) || options.isRenderCallback(value)) {
      entry.value = lowered;
      continue;
    }
    walkAst<t.Node>(value, {
      enter(current) {
        if (b.isArrowFunctionExpression(current) || b.isFunctionExpression(current)) {
          if (current.generator) fail('desktop callback props cannot be generators', current);
          if (nodeHasJsx(current))
            fail('JSX callbacks require a declared render-callback prop', current);
          return false;
        }
        if (b.isJSXElement(current) || b.isJSXFragment(current) || b.isJSXEmptyExpression(current))
          fail('JSX values require a declared content prop', current);
      },
    });
  }
  const props = emitOrderedAttributes(attributes);
  if (hasChildren) {
    const content = b.jsxFragment(b.jsxOpeningFragment(), b.jsxClosingFragment(), element.children);
    props.properties.push(b.objectProperty(b.identifier('children'), options.content(content)));
    dependencies = null;
  }
  return {
    component: b.identifier(tag),
    props,
    sources: dependencies === null ? null : [...dependencies].sort(),
  };
}
